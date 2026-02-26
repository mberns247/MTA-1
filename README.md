# MTA Arrival Board Dashboard

Mobile-friendly, dark-mode dashboard showing live arrivals for:

- **Subway:** Gates Av (J/Z) — Manhattan-bound. Next 4 trains with minutes until arrival.
- **Bus:** B52 at Gates Ave & Evergreen Ave — East / Ridgewood-bound. Next 4 buses with minutes until arrival.

---

## Putting it on the internet (step-by-step, no experience needed)

This section is written so you don’t need to know coding or tech. Do the steps in order.

**What you’ll get:** A link (like `https://something.vercel.app`) that you can open on your iPad or phone to see your arrival board.

**What you’ll use:**  
- **GitHub** = a website where people store code. You’ll put your project there so Vercel can use it.  
- **Terminal** = a program on your Mac where you type text commands. You’ll use it once to “push” your project to GitHub.  
- **Vercel** = a website that turns your project into a real site and gives you a link.

---

### Part 1: Put your project on GitHub

1. **Open GitHub**
   - Go to [github.com](https://github.com) in your browser.
   - Sign in, or create a free account if you don’t have one.

2. **Create a new “repository” (a place for your project)**
   - Click the **+** at the top right.
   - Click **New repository**.
   - Where it says **Repository name**, type: **mta**
   - Leave everything else as it is. Click the green **Create repository** button.

3. **Open Terminal on your Mac**
   - Press **Command + Space**, type **Terminal**, press Enter. A window opens with a line of text and a blinking cursor. That’s Terminal.

4. **Tell Terminal to go to your project folder**
   - Type this exactly (or copy and paste it) and press Enter:
     ```text
     cd /Users/mberns247/mta
     ```
   - That just means “go to the mta folder.” You won’t see much happen; that’s normal.

5. **Prepare the project for GitHub (one-time setup)**
   - Copy and paste this whole block, then press Enter:
     ```text
     git init
     git add .
     git commit -m "MTA arrival board"
     git branch -M main
     git remote add origin https://github.com/mberns247/mta.git
     ```
   - If it says something like “fatal: remote origin already exists,” that’s okay — it means you did this before. Skip to step 6.

6. **Send your project to GitHub**
   - Type this and press Enter:
     ```text
     git push -u origin main
     ```
   - It might ask for your **username**: type **mberns247** and press Enter.
   - It might ask for a **password**. GitHub no longer accepts your normal account password here. You need a **Personal Access Token**:
     - In another tab, go to GitHub → click your profile picture (top right) → **Settings** → scroll down the left side and click **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
     - Give it a name like “vercel” and check the box **repo**. Click **Generate token**.
     - **Copy the token** (it looks like a long string of letters and numbers). Paste that when Terminal asks for a password (you won’t see it as you type — that’s normal). Press Enter.
   - When it’s done, you might see something like “branch 'main' set up to track 'origin/main'.” That means it worked.

7. **Check that it’s on GitHub**
   - Go to [github.com/mberns247/mta](https://github.com/mberns247/mta) in your browser. You should see your project files (e.g. a **dashboard** folder). If you see that, Part 1 is done.

---

### Part 2: Turn it into a real website with Vercel

1. **Open Vercel**
   - Go to [vercel.com](https://vercel.com) in your browser.
   - Click **Sign Up** or **Log In** and choose **Continue with GitHub**. Log in with your GitHub account if it asks.

2. **Create a new project**
   - Click **Add New…** (or **New Project**).
   - You’ll see a list of your GitHub stuff. Find **mta** and click **Import** next to it.

3. **Set the “Root Directory” (this is important)**
   - Before you click Deploy, look for **Root Directory**.
   - Click **Edit** next to it. Type: **dashboard**
   - That tells Vercel “the actual app is inside the folder named dashboard.” Click outside the box or press Enter to confirm.

4. **Add your bus API key**
   - Find the section **Environment Variables**.
   - Under **Name**, type: **MTA_BUS_TIME_KEY**
   - Under **Value**, paste your MTA Bus Time API key (the same one you put in `.env.local` on your computer).
   - Click **Add** (or the plus). You can add more variables later if you want; this one is the one you need for the bus times to work.

5. **Deploy**
   - Click the **Deploy** button. Vercel will build your site. Wait 1–2 minutes. You’ll see a progress screen.

6. **Get your link**
   - When it says **Congratulations** or **Your project has been deployed**, click **Visit** (or **Go to Dashboard** and then click the link to your project). The URL will look like: **https://mta-xxxx.vercel.app** (yours will have different letters/numbers). That’s your real website.

---

### Part 3: Open it on your iPad

1. On your iPad, open **Safari** (or any browser).
2. Type or paste your Vercel link (e.g. **https://mta-xxxx.vercel.app**) in the address bar and go.
3. You should see your MTA Arrival Board. You can **Add to Home Screen** (Share button → Add to Home Screen) so it’s like an app on your iPad.

If the bus section says something like “key not configured,” go back to Vercel → your project → **Settings** → **Environment Variables** and make sure **MTA_BUS_TIME_KEY** is there and has the correct value, then redeploy.

---

## Local run

Start the app **from this directory** (`mta/dashboard`) so `/api/arrivals` and other API routes are available:

```bash
npm install
cp .env.example .env.local
# Edit .env.local and add your keys (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To use port 3004 instead: `npm run dev:3004`, then open [http://localhost:3004](http://localhost:3004).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MTA_BUS_TIME_KEY` | Yes (for bus tile) | MTA Bus Time API key. Get one at [bustime.mta.info/wiki/Developers/Index](https://bustime.mta.info/wiki/Developers/Index). |
| `MTA_SUBWAY_GTFS_RT_KEY` | No | MTA GTFS-Realtime API key. If set, sent as `x-api-key` header. Get one at [api.mta.info](https://api.mta.info/). |
| `SUBWAY_STOP_ID` | No | Force platform: `J30N` or `J30S`. If unset, the app tries both and uses the one with more arrivals in the next ~30 minutes. |

Do **not** commit `.env.local` or any file containing real keys.

## API routes (server-side only)

- `GET /api/bus` — Returns `{ arrivals: [{ route, destination?, expectedInMin }] }`. All API calls use server-side env; no keys in client JS.
- `GET /api/subway` — Returns `{ arrivals: [{ route, destination?, arrivalInMin, stopId }], stopId }`. Optional query: `?stopId=J30N` or `?stopId=J30S`.

## Config panel

- **Subway platform:** Override auto-detect with J30N or J30S (stored in `localStorage`).
- **Refresh interval:** Default 20 seconds; adjustable (min 5s).

## Deploy to a real website (e.g. open on your iPad)

Use **Vercel** (free) to get a URL like `https://your-project.vercel.app` that you can open on your iPad.

### Step 1: Put your code on GitHub

1. Go to [github.com](https://github.com) and sign in (or create an account).
2. Click the **+** (top right) → **New repository**.
3. Name it `mta` (or anything), leave other options default, click **Create repository**.
4. On your computer, open Terminal and run (use your actual GitHub username and repo name):

   ```bash
   cd /Users/mberns247/mta
   git init
   git add .
   git commit -m "MTA arrival board dashboard"
   git branch -M main
   git remote add origin https://github.com/mberns247/mta.git
   git push -u origin main
   ```

   If it asks for a password, use a **Personal Access Token** from GitHub (Settings → Developer settings → Personal access tokens) instead of your account password.

### Step 2: Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (choose **Continue with GitHub**).
2. Click **Add New…** → **Project**.
3. **Import** your `mta` repository. Click **Import**.
4. **Important:** Under **Root Directory**, click **Edit**, type `dashboard`, and confirm. (Your app lives inside the `dashboard` folder.)
5. **Environment Variables:** Click **Environment Variables** and add:
   - **Name:** `MTA_BUS_TIME_KEY`  
     **Value:** your MTA Bus Time API key (the same one in your `.env.local`)  
   Then click **Add**. You can add `MTA_SUBWAY_GTFS_RT_KEY` and `SUBWAY_STOP_ID` later if you want.
6. Click **Deploy**. Wait a minute or two.
7. When it’s done, click **Visit** (or open the URL Vercel shows, e.g. `https://mta-xxxx.vercel.app`).

### Step 3: Open on your iPad

- On your iPad, open **Safari** (or any browser).
- Type or paste your Vercel URL (e.g. `https://mta-xxxx.vercel.app`).
- Optionally: **Share** → **Add to Home Screen** so the arrival board appears like an app on your home screen.

---

### Vercel reference (if you need to change settings later)

- **Root Directory:** `dashboard`
- **Build Command:** `npm run build` (default)
- **Install Command:** `npm install` (default)
- **Environment Variables:** `MTA_BUS_TIME_KEY` (required for bus), optionally `MTA_SUBWAY_GTFS_RT_KEY`, `SUBWAY_STOP_ID`

## Tech

- Next.js 14 (App Router), TypeScript.
- Bus: MTA Bus Time SIRI stop-monitoring API.
- Subway: MTA GTFS-Realtime, parsed with `gtfs-realtime-bindings`.
- No API keys in client; all requests go through `/api/arrivals`, `/api/bus`, and `/api/subway`.
- Subway and bus options are loaded from `data/subway-options.json` and `data/bus-options.json` (generated from MTA GTFS).

### Regenerating stop lists

To refresh the list of subway or bus stops from the latest MTA GTFS:

```bash
node scripts/build-subway-options.cjs   # writes data/subway-options.json
node scripts/build-bus-options.cjs      # writes data/bus-options.json
```

Then rebuild the app. Subway uses [GTFS subway](https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip); bus uses the six borough/company GTFS zips.
