// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HmVoice",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "HmVoice", targets: ["HMVoicePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/twilio/twilio-voice-ios", from: "6.13.0")
    ],
    targets: [
        .target(
            name: "HMVoicePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "TwilioVoice", package: "twilio-voice-ios")
            ],
            path: "ios/Sources/HMVoicePlugin")
    ]
)
