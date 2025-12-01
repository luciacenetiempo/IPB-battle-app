# Italian Prompt Battle - Walkthrough

The application is now running! Here is how to operate the event.

## 1. Access Points

Open the following URLs in separate browser windows/tabs (or devices):

- **Admin Panel (Regia)**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Big Screen (Maxi Schermo)**: [http://localhost:3000/screen](http://localhost:3000/screen)
- **Participant**: [http://localhost:3000/participant](http://localhost:3000/participant) (Open multiple for testing)
- **Public Vote**: [http://localhost:3000/vote](http://localhost:3000/vote)

## 2. Running a Round (Step-by-Step)

### Step 1: Setup
1. Go to **Admin Panel**.
2. Enter **Round Number** (e.g., 1) and **Theme** (e.g., "Cyberpunk Pizza").
3. Click **START ROUND**.
   - *Effect*: The Big Screen updates with the theme. Participants can now type. Timer starts (60s).

### Step 2: Writing Phase
1. On **Participant** screens, type prompts.
2. Observe the **Big Screen**: You will see the text appearing in real-time (if you want to verify latency).
3. Wait for timer to hit 0 OR click **STOP TIMER** in Admin.

### Step 3: Generation Phase
1. When timer ends, the status changes to `GENERATING`.
2. Textareas are locked.
3. Big Screen shows placeholders.
4. In a real scenario, this is where Flux API would return images.
5. Click **TRIGGER GENERATION** in Admin to simulate moving to the next phase (or just to ensure state is set).

### Step 4: Voting Phase
1. Click **START VOTING** in Admin.
2. Big Screen shows voting bars.
3. Go to **Public Vote** page on mobile/other tab.
4. Select a participant and click **CONFIRM VOTE**.
5. Watch the bars animate on the Big Screen.

### Step 5: End Round
1. When voting timer ends (or you click stop), the winner is calculated.
2. Big Screen announces the winner.

## 3. Notes
- **Resiliency**: If you refresh the Participant page, you can rejoin (enter same name/different name).
- **State**: The server holds the state in memory. Restarting the server resets the game.
