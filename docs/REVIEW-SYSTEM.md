# The review system, step by step

This is the core of the product: how a customer goes from "the owner added them" to "a Google review with a reply on it", and how to set up the pictures that make it work.

## The flow

1. **Customer added.** The owner adds a name and mobile number in the app (or you import a list in ops). Numbers on the do-not-contact list are skipped.
2. **Text 1** goes out after the first delay (default 2 hours). It carries the business's **sign photo**: their team holding a board with the customer's first name written on it.
3. **Text 2** goes out 3 days later if they haven't reviewed. It carries the **crying meme**: a heartbroken photo of the team with the caption "WHEN {NAME} HASN'T LEFT ME A REVIEW" and a crying emoji 😭 above the words.
4. **Text 3** (optional) is a last, plain reminder at 7 days.
5. **The link.** Each text has a link to the customer's own tracked page. Opening it records the tap and sends them straight to the business's Google review box. Nothing filters out unhappy customers.
6. **Review lands.** The `reviews` cron runs every hour. It pulls new Google reviews, matches each one to the customer who left it (by name, with Claude for close calls), marks them reviewed and cancels their remaining texts.
7. **Reply.** Claude writes a reply in the business's voice and posts it to Google (if `auto_reply` is on for that business; otherwise it waits in ops, Reviews).
8. **Owner sees it.** Push notification to the owner, and the review with its reply shows in their app.

Code: `lib/sequence.ts` (steps, `DEFAULT_STEPS`), `lib/requests.ts` (queueing and sending), `app/api/cron/send` (every 5 minutes), `app/r/[code]` (tracked link), `lib/reviews.ts` + `lib/gbp.ts` (sync, matching, replies), `lib/poster.ts` + `lib/poster-render.ts` (pictures).

Edit the wording, delays and which picture each step uses per business in ops: the client's page, Message sequence (each step has a Picture dropdown). `{name}`, `{business}` and `{link}` are filled in for each customer. The owner never sees these automated texts in their inbox; only ops does.

## The pictures

Every picture is drawn by code for each customer. **No AI runs per text.** AI is used once per client to make the two base photos, and that's it.

### 1. Sign photo (Text 1)

1. Ask the client for **one photo**: their team at a job site, standing with a gap between them, hands up as if holding a board. They do not need a real board.
2. Add a blank white board between their hands with an AI image edit. Do this once.
3. Ops, the client's page, Pictures, box 1: upload it, click the board's four corners, type a test name, preview, save.

From then on the code writes each customer's first name on the board in a marker font, warps it to the board's angle and blends it into the photo.

### 2. Crying meme (Text 2)

1. From the same team photo, make a heartbroken or crying version **once, with ChatGPT** (image edit: "make them look heartbroken, like they're crying"). This one image is reused for every customer the client ever has. Never generate it again per customer.
2. Ops, Pictures, box 2: upload it and set the caption. The default is "When {name} hasn't left me a review"; add 😭 at the end to get the crying emoji. Preview, save.

The code prints the caption in white meme capitals at the bottom of the photo with the customer's name filled in. If the caption contains 😭, the code draws the crying emoji above the words from `lib/poster-assets/emoji/1f62d.png`. That emoji picture was also **generated once with ChatGPT** and lives in the repo. It is not created per text. To add another emoji, put a PNG named by its Unicode code point (for example `1f97a.png` for 🥺) in that folder.

### 3. Test before going live

Ops, Pictures, box 3, Send test: sends Text 1 and Text 2 right now to your phone, then stops that test request. Check both pictures arrive and the name looks right.

A client with no photos still works: the texts go out with words only. A missing picture never blocks a review request.

## Checklist for each new client

- [ ] Google Business Profile manager access accepted, account and location ids on the business, reviews synced
- [ ] `review_link` set (the Google "write a review" link)
- [ ] Texting line: house line, or their own number with an approved A2P campaign
- [ ] Sign photo uploaded with corners clicked (box 1)
- [ ] Crying meme made once with ChatGPT and uploaded with caption (box 2)
- [ ] Test sent to your own phone (box 3), both pictures look right
- [ ] Auto-reply on or off as agreed
- [ ] Owner has installed the app and added their first customers
