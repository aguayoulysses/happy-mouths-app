import { NAME, BRAND } from "@/lib/whitelabel";

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy</h1>
      <div className="mt-6 space-y-4 leading-relaxed text-ink-soft">
        <p>{NAME} is a tool that businesses use to ask their customers for Google reviews by text message.</p>
        <p><strong className="text-ink">What we store.</strong> For each business: the owner&rsquo;s name, email, phone number and password (hashed). For each customer a business adds: a name and phone number, when the review request was sent, and whether the link was opened. If a business links its Google Business Profile, we keep a copy of its public reviews and profile numbers (views and calls) so the owner can see them in the app.</p>
        <p><strong className="text-ink">Tools in your plan.</strong> If your plan includes them, we also store: text messages and photos between your business number and your customers; a log of calls on your business line (who, when and how long; calls are not recorded); the receipts, invoices and quotes you create; the job photos you add, which we post to your Google Business Profile; and your chat with our team. The app uses the microphone only during a call you place, and the camera and photo library only when you choose to add a photo.</p>
        <p><strong className="text-ink">AI.</strong> When you create a receipt, invoice or quote, the job description you type is sent to Anthropic&rsquo;s Claude, an AI service, to draft the document. The app asks for your permission first. Anthropic does not use it to train its models, and nothing else in your account is sent.</p>
        <p><strong className="text-ink">What we don&rsquo;t do.</strong> We do not sell data, share customer numbers with anyone but the business that added them, or use them for advertising. Text messages and calls go through Twilio. Photos and review replies go to Google. Push notifications go through Apple.</p>
        <p><strong className="text-ink">Customers.</strong> Reply STOP to any message to never hear from that business through {NAME} again.</p>
        <p><strong className="text-ink">Deleting your data.</strong> Business owners can delete their account from Settings in the app (Settings → Delete my account), which permanently removes the business and every customer record with it. Anyone can email {BRAND.supportEmail} to have their number removed.</p>
      </div>
    </main>
  );
}
