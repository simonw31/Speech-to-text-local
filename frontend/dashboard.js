const { ipcRenderer } = require('electron');
const API_URL = "http://127.0.0.1:8000";

// --- CONFIGURATION DES MODÈLES (C'est ici qu'on définit les choix) ---
const AVAILABLE_MODELS = [
    { value: "tiny", label: "Tiny (Ultra Rapide - Peu précis)" },
    { value: "base", label: "Standard (Rapide)" },
    { value: "small", label: "Amélioré (Équilibré)" },
    { value: "medium", label: "Précis (Lent)" },
    { value: "large-v3", label: "Ultra (Très Lent - Max Qualité)" }
];

// UI ELEMENTS
const closeBtn = document.getElementById('closeBtn');
const minBtn = document.getElementById('minBtn');
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const saveBtn = document.getElementById('saveBtn');
const historyList = document.getElementById('historyList');
const hotkeyRecord = document.getElementById('hotkeyRecord');

// STATE LOCAL
let currentMicIndex = 0;
let currentModel = "large-v3";
let currentHotkey = "ctrl+space";
let isRecordingKey = false;

// --- WINDOW ---
closeBtn.addEventListener('click', () => ipcRenderer.send('close-dashboard'));
minBtn.addEventListener('click', () => ipcRenderer.send('minimize-dashboard'));

// --- NAVIGATION ---
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetId = item.getAttribute('data-target');
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        pages.forEach(p => p.classList.remove('active'));
        document.getElementById(targetId + '-page').classList.add('active');
        if (targetId === 'history') loadHistory();
    });
});

// --- CUSTOM SELECT LOGIC ---
function setupCustomSelect(id, onSelect) {
    const el = document.getElementById(id);
    const trigger = el.querySelector('.select-trigger');
    const optionsList = el.querySelector('.options-list');
    const triggerSpan = trigger.querySelector('span');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-select').forEach(s => {
            if (s !== el) s.classList.remove('open');
        });
        el.classList.toggle('open');
    });

    optionsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('option')) {
            const val = e.target.getAttribute('data-value');
            const txt = e.target.innerText;
            
            triggerSpan.innerText = txt;
            el.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            el.classList.remove('open');
            
            onSelect(val);
        }
    });
}

document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select').forEach(s => s.classList.remove('open'));
});

// Setup Callbacks
setupCustomSelect('modelSelect', (val) => { currentModel = val; });
setupCustomSelect('micSelect', (val) => { currentMicIndex = parseInt(val); });

// --- HOTKEY RECORDER ---
hotkeyRecord.addEventListener('click', () => {
    isRecordingKey = true;
    hotkeyRecord.innerText = "Appuyez sur les touches...";
    hotkeyRecord.classList.add('recording');
});

document.addEventListener('keydown', (e) => {
    if (!isRecordingKey) return;
    e.preventDefault();
    const keys = [];
    if (e.ctrlKey) keys.push('ctrl');
    if (e.metaKey) keys.push('win');
    if (e.altKey) keys.push('alt');
    if (e.shiftKey) keys.push('shift');
    
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        let k = e.key.toLowerCase();
        if(k === ' ') k = 'space';
        keys.push(k);
        if (keys.length > 1 || k.length > 1 || (k >= 'a' && k <= 'z')) {
            currentHotkey = keys.join('+');
            hotkeyRecord.innerText = currentHotkey;
            hotkeyRecord.classList.remove('recording');
            isRecordingKey = false;
        }
    } else {
        hotkeyRecord.innerText = keys.join('+') + '...';
    }
});

// --- LOAD DATA (GÉNÉRATION DYNAMIQUE) ---
async function loadData() {
    try {
        // 1. Récup Config
        const cRes = await fetch(`${API_URL}/config`);
        const conf = await cRes.json();
        
        if (conf.model_size) currentModel = conf.model_size;
        if (conf.hotkey) currentHotkey = conf.hotkey;
        if (conf.mic_index !== undefined) currentMicIndex = conf.mic_index;
        
        // Update Hotkey UI
        hotkeyRecord.innerText = currentHotkey;

        // 2. GÉNÉRATION LISTE MODÈLES (FIX)
        const modelList = document.querySelector('#modelSelect .options-list');
        const modelTrigger = document.querySelector('#modelSelect .select-trigger span');
        modelList.innerHTML = ""; // On vide
        
        let modelFound = false;

        AVAILABLE_MODELS.forEach(m => {
            const div = document.createElement('div');
            div.className = 'option';
            div.setAttribute('data-value', m.value);
            div.innerText = m.label;

            // Si c'est celui de la config, on le sélectionne DIRECTEMENT à la création
            if (m.value === currentModel) {
                div.classList.add('selected');
                modelTrigger.innerText = m.label; // On met à jour le texte visible
                modelFound = true;
            }
            modelList.appendChild(div);
        });

        // Fallback si la config est corrompue
        if (!modelFound) {
            modelTrigger.innerText = AVAILABLE_MODELS[4].label; // Large-v3 par défaut
            currentModel = "large-v3";
        }

        // 3. GÉNÉRATION LISTE MICROS
        const mRes = await fetch(`${API_URL}/devices`);
        const devices = await mRes.json();
        const micList = document.querySelector('#micSelect .options-list');
        const micTrigger = document.querySelector('#micSelect .select-trigger span');
        
        micList.innerHTML = "";
        let micFound = false;
        
        devices.forEach(d => {
            const div = document.createElement('div');
            div.className = 'option';
            div.setAttribute('data-value', d.index);
            div.innerText = d.name;
            
            if (d.index === currentMicIndex) {
                div.classList.add('selected');
                micTrigger.innerText = d.name;
                micFound = true;
            }
            micList.appendChild(div);
        });
        
        if (!micFound && devices.length > 0) {
             micTrigger.innerText = devices[0].name;
             currentMicIndex = devices[0].index;
        } else if (devices.length === 0) {
            micTrigger.innerText = "Aucun micro détecté";
        }

    } catch(e) {
        console.error("Erreur LoadData:", e);
    }
}

// --- SAVE ---
saveBtn.addEventListener('click', async () => {
    const settings = {
        mic_index: currentMicIndex,
        model_size: currentModel,
        hotkey: currentHotkey
    };
    saveBtn.innerText = "Sauvegarde...";
    try {
        await fetch(`${API_URL}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
        saveBtn.innerText = "Enregistré !";
        saveBtn.style.background = "#30d158";
        saveBtn.style.color = "black";
        setTimeout(() => { 
            saveBtn.innerText = "Enregistrer les modifications"; 
            saveBtn.style.background = "#ffffff";
            saveBtn.style.color = "black"; 
        }, 2000);
    } catch (e) { saveBtn.innerText = "Erreur"; saveBtn.style.background = "#ff453a"; }
});

// --- HISTORY ---
async function loadHistory() {
    historyList.innerHTML = "<div style='text-align:center;color:#666;margin-top:20px'>Chargement...</div>";
    try {
        const res = await fetch(`${API_URL}/history`);
        const data = await res.json();
        if (data.length === 0) { historyList.innerHTML = "<div class='empty-hist'>Aucun historique récent</div>"; return; }
        historyList.innerHTML = "";
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `<div class="hist-time">${item.time}</div><div class="hist-text">${item.text}</div>`;
            historyList.appendChild(div);
        });
    } catch (e) { historyList.innerHTML = "<div class='empty-hist'>Backend Offline</div>"; }
}

loadData();