// script.js

const chatContainer = document.getElementById("chat-container");
const userInput = document.getElementById("user-input");
const fileInput = document.getElementById("fileInput");

function appendMessage(role, content, isImage = false) {
  const div = document.createElement("div");
  div.className = role === "user" ? "user-msg" : "ai-msg";

  if (isImage) {
    const img = document.createElement("img");
    img.src = content;
    img.style.maxWidth = "200px";
    div.appendChild(img);
  } else {
    div.innerText = content;
  }

  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  const data = await response.json();
  appendMessage("ai", data.response);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = () => {
      appendMessage("user", reader.result, true);
    };
    reader.readAsDataURL(file);
  } else if (file.name.endsWith(".pdf")) {
    const reader = new FileReader();
    reader.onload = async () => {
      const typedArray = new Uint8Array(reader.result);
      const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(i => i.str).join(" ") + "\n";
      }
      userInput.value = text;
    };
    reader.readAsArrayBuffer(file);
  } else if (file.name.endsWith(".txt")) {
    const reader = new FileReader();
    reader.onload = () => {
      userInput.value = reader.result;
    };
    reader.readAsText(file);
  } else {
    alert("File tidak didukung.");
  }
});
