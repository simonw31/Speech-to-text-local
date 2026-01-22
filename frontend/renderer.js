const { ipcRenderer } = require('electron');
const appEl = document.getElementById('app');
const pillEl = document.querySelector('.pill');
const textEl = document.getElementById('text');
const API_URL = "http://127.0.0.1:8000";

setInterval(checkState, 50);

async function checkState() {
    try {
        const res = await fetch(`${API_URL}/state`);
        const data = await res.json();
        updateUI(data.status, data.text);
    } catch (e) {}
}

let currentStatus = "idle";

function updateUI(status, textResult) {
    if (status === currentStatus) return;
    currentStatus = status;
    pillEl.classList.remove('recording', 'processing', 'success', 'error');

    if (status === "idle") {
        appEl.classList.remove('visible');
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    } 
    else {
        appEl.classList.add('visible');
        // On laisse passer les clics même quand c'est visible
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        
        if (status === "recording") {
            pillEl.classList.add('recording');
            textEl.innerText = "Listening...";
        }
        else if (status === "processing") {
            pillEl.classList.add('processing');
            textEl.innerText = "Thinking...";
        }
        else if (status === "success") {
            pillEl.classList.add('success');
            textEl.innerText = "Done";
        }
        else if (status === "error") {
            pillEl.classList.add('error');
            textEl.innerText = "Error";
        }
    }
}