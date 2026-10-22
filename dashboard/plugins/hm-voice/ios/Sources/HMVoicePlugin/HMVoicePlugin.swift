import Foundation
import AVFoundation
import CallKit
import Capacitor
import TwilioVoice

/// Outgoing calls from inside the app. The call goes out over the internet
/// through Twilio and shows the business number; CallKit gives it the normal
/// iPhone call treatment (audio routing, lock screen, survives backgrounding).
/// Incoming calls are not handled here: they forward to the owner's cell.
@objc(HMVoicePlugin)
public class HMVoicePlugin: CAPPlugin, CAPBridgedPlugin, CXProviderDelegate, CallDelegate {
    public let identifier = "HMVoicePlugin"
    public let jsName = "HMVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "call", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hangup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendDigits", returnType: CAPPluginReturnPromise)
    ]

    private let audioDevice = DefaultAudioDevice()
    private var provider: CXProvider?
    private let callController = CXCallController()
    private var activeCall: Call?
    private var activeUUID: UUID?
    private var pending: (token: String, to: String, key: String)?
    private var speakerOn = false

    override public func load() {
        TwilioVoiceSDK.audioDevice = audioDevice
        let config = CXProviderConfiguration()
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportsVideo = false
        config.supportedHandleTypes = [.phoneNumber]
        config.includesCallsInRecents = false
        let p = CXProvider(configuration: config)
        p.setDelegate(self, queue: nil)
        provider = p
    }

    // MARK: JS API

    @objc func call(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let to = call.getString("to"), let key = call.getString("key") else {
            call.reject("Missing token, to or key")
            return
        }
        if activeCall != nil || activeUUID != nil {
            call.reject("A call is already in progress")
            return
        }
        let display = call.getString("display") ?? to
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    call.reject("Microphone access is off. Turn it on in Settings to call from the app.", "MIC_DENIED")
                    return
                }
                let uuid = UUID()
                self.pending = (token, to, key)
                self.activeUUID = uuid
                self.speakerOn = false
                let handle = CXHandle(type: .phoneNumber, value: to)
                let action = CXStartCallAction(call: uuid, handle: handle)
                action.contactIdentifier = display
                self.callController.request(CXTransaction(action: action)) { error in
                    DispatchQueue.main.async {
                        if let error = error {
                            self.pending = nil
                            self.activeUUID = nil
                            call.reject("Could not start the call: \(error.localizedDescription)")
                        } else {
                            let update = CXCallUpdate()
                            update.remoteHandle = handle
                            update.localizedCallerName = display
                            update.supportsDTMF = true
                            update.supportsHolding = false
                            update.supportsGrouping = false
                            update.supportsUngrouping = false
                            update.hasVideo = false
                            self.provider?.reportCall(with: uuid, updated: update)
                            call.resolve()
                        }
                    }
                }
            }
        }
    }

    @objc func hangup(_ call: CAPPluginCall) {
        if let uuid = activeUUID {
            callController.request(CXTransaction(action: CXEndCallAction(call: uuid))) { _ in }
        } else {
            activeCall?.disconnect()
        }
        call.resolve()
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        if let uuid = activeUUID {
            callController.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: muted))) { _ in }
        }
        activeCall?.isMuted = muted
        call.resolve()
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        speakerOn = call.getBool("on") ?? false
        applySpeaker()
        call.resolve()
    }

    @objc func sendDigits(_ call: CAPPluginCall) {
        if let digits = call.getString("digits"), !digits.isEmpty {
            activeCall?.sendDigits(digits)
        }
        call.resolve()
    }

    // MARK: Helpers

    private func applySpeaker() {
        let on = speakerOn
        audioDevice.block = {
            DefaultAudioDevice.DefaultAVAudioSessionConfigurationBlock()
            do {
                try AVAudioSession.sharedInstance().overrideOutputAudioPort(on ? .speaker : .none)
            } catch {
                NSLog("HMVoice speaker toggle failed: \(error.localizedDescription)")
            }
        }
        audioDevice.block()
    }

    private func emit(_ state: String, error: String? = nil) {
        var data: [String: Any] = ["state": state]
        if let error = error { data["error"] = error }
        notifyListeners("state", data: data)
    }

    private func finish(error: String? = nil) {
        if let uuid = activeUUID {
            provider?.reportCall(with: uuid, endedAt: Date(), reason: error == nil ? .remoteEnded : .failed)
        }
        activeCall = nil
        activeUUID = nil
        pending = nil
        audioDevice.isEnabled = false
        emit("ended", error: error)
    }

    // MARK: CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        activeCall?.disconnect()
        audioDevice.isEnabled = false
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        audioDevice.isEnabled = true
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioDevice.isEnabled = false
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        guard let p = pending else {
            action.fail()
            return
        }
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        let options = ConnectOptions(accessToken: p.token) { builder in
            builder.params = ["To": p.to, "k": p.key]
            builder.uuid = action.callUUID
        }
        activeCall = TwilioVoiceSDK.connect(options: options, delegate: self)
        emit("connecting")
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let call = activeCall {
            call.disconnect()
        } else {
            finish()
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        activeCall?.isMuted = action.isMuted
        notifyListeners("state", data: ["state": "connected", "muted": action.isMuted])
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
        activeCall?.sendDigits(action.digits)
        action.fulfill()
    }

    // MARK: CallDelegate

    public func callDidStartRinging(call: Call) {
        emit("ringing")
    }

    public func callDidConnect(call: Call) {
        if let uuid = activeUUID {
            provider?.reportOutgoingCall(with: uuid, connectedAt: Date())
        }
        applySpeaker()
        emit("connected")
    }

    public func callIsReconnecting(call: Call, error: Error) {
        emit("reconnecting")
    }

    public func callDidReconnect(call: Call) {
        emit("connected")
    }

    public func callDidFailToConnect(call: Call, error: Error) {
        finish(error: error.localizedDescription)
    }

    public func callDidDisconnect(call: Call, error: Error?) {
        finish(error: error?.localizedDescription)
    }
}
