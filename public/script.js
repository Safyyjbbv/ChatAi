document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('form');
  const chatContainer = document.getElementById('chat-container');
  const input = document.getElementById('input');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const userMessage = input.value.trim();
    if (!userMessage) return;

    appendMessage('user', userMessage);
    input.value = '';

    // === Tambahkan waktu lokal ke dalam prompt ===
    const now = new Date();
    const localDate = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const localTime = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const timeContext = `\n\n[Waktu lokal saat ini: ${localDate}, pukul ${localTime}]`;
    const finalPrompt = `${userMessage}${timeContext}`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: finalPrompt })
      });

      const data = await res.json();
      const botMessage = data.message || 'Maaf, tidak ada respon.';
      appendMessage('bot', botMessage);
    } catch (err) {
      console.error(err);
      appendMessage('bot', 'Terjadi kesalahan. Coba lagi nanti.');
    }
  });

  function appendMessage(sender, text) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}`;
    messageElement.innerText = text;
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});
