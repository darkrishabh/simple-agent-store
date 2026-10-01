const button = document.querySelector("#copy-command");
const status = document.querySelector("#copy-status");
const command = document.querySelector("#start-command");

if (button && status && command) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(command.textContent);
      status.textContent = "Commands copied. Paste them into your terminal.";
    } catch {
      status.textContent = "Clipboard access is unavailable. Select and copy the commands above.";
    } finally {
      button.disabled = false;
    }
  });
}
