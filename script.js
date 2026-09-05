// ==UserScript==
// @name         Nikolas Quizizz v51.8 - Resposta Completa
// @version      51.8
// @description  Mostra a resposta completa (ex: A - 4) e esconde o cursor enquanto a bolinha está ativa
// @author       Nikolas
// @match        https://wayground.com/join/game/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // CONFIGURAÇÃO
    // =========================================================
    const GEMINI_API_KEYS = [
        "CHAVE_GEMINI_1",
        "CHAVE_GEMINI_2",
        "CHAVE_GEMINI_3"
    ];
    const MODEL = "gemini-2.5-flash";
    const REQUEST_TIMEOUT = 45000;
    const MAX_RETRIES_PER_KEY = 2;
    let currentKeyIndex = 0;
    let busy = false;

    // =========================================================
    // IDs
    // =========================================================
    const STYLE_ID = "nikolas-v518-style";
    const BALL_ID = "nikolas-v518-ball";
    const RESULT_ID = "nikolas-v518-result";

    // =========================================================
    // ESTILO
    // =========================================================
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            /* Força o cursor a sumir */
            html.nikolas-hide-cursor,
            html.nikolas-hide-cursor * {
                cursor: none !important;
            }

            #${BALL_ID} {
                position: fixed;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                pointer-events: none;
                z-index: 2147483647;
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.6);
                transition: opacity .15s ease, transform .15s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                font-weight: 700;
                color: white;
            }

            #${BALL_ID}.visible {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }

            #${BALL_ID}.loading {
                background: #00c8ff;
                box-shadow: 0 0 14px #00c8ff, 0 0 28px rgba(0,200,255,.5);
                animation: nikolasSpin 0.65s linear infinite;
            }

            #${BALL_ID}.success {
                background: #00d97e;
                box-shadow: 0 0 14px #00d97e, 0 0 28px rgba(0,217,126,.5);
            }

            #${BALL_ID}.error {
                background: #ff3355;
                box-shadow: 0 0 14px #ff3355, 0 0 28px rgba(255,51,85,.5);
            }

            #${RESULT_ID} {
                position: fixed;
                left: 50%;
                bottom: 36px;
                transform: translateX(-50%) translateY(12px);
                width: min(500px, calc(100vw - 36px));
                box-sizing: border-box;
                padding: 16px 20px;
                border-radius: 14px;
                background: linear-gradient(135deg, rgba(8,14,21,.97), rgba(10,22,29,.96));
                border: 1px solid rgba(0,255,136,.4);
                box-shadow: 0 8px 32px rgba(0,0,0,.4), 0 0 20px rgba(0,255,136,.12);
                color: #fff;
                font-family: Inter, Poppins, Arial, sans-serif;
                z-index: 2147483646;
                opacity: 0;
                animation: nikolasResultIn .22s ease-out forwards;
            }

            #${RESULT_ID}.error {
                border-color: rgba(255,51,85,.5);
            }

            .nikolas-result-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .1em;
                text-transform: uppercase;
                opacity: .65;
            }

            .nikolas-result-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #00ff88;
                box-shadow: 0 0 8px #00ff88;
            }

            .nikolas-result-text {
                font-size: 18px;
                line-height: 1.35;
                font-weight: 600;
            }

            .nikolas-result-hint {
                margin-top: 8px;
                font-size: 12px;
                color: rgba(255,255,255,.48);
            }

            @keyframes nikolasSpin {
                from { transform: translate(-50%, -50%) rotate(0deg); }
                to   { transform: translate(-50%, -50%) rotate(360deg); }
            }

            @keyframes nikolasResultIn {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(12px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================
    // BOLINHA + ESCONDER CURSOR
    // =========================================================
    let mouseX = 0;
    let mouseY = 0;

    document.addEventListener("mousemove", e => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        const ball = document.getElementById(BALL_ID);
        if (ball && ball.classList.contains("visible")) {
            ball.style.left = mouseX + "px";
            ball.style.top = mouseY + "px";
        }
    }, true);

    function createBall() {
        let ball = document.getElementById(BALL_ID);
        if (ball) return ball;

        ball = document.createElement("div");
        ball.id = BALL_ID;
        document.body.appendChild(ball);
        return ball;
    }

    function setBallStatus(type) {
        const ball = createBall();
        ball.className = "";

        if (type === "loading" || type === "success" || type === "error") {
            // Mostra a bolinha e esconde o cursor
            document.documentElement.classList.add("nikolas-hide-cursor");

            if (type === "loading") {
                ball.textContent = "";
                ball.classList.add("loading", "visible");
            } else if (type === "success") {
                ball.textContent = "✓";
                ball.classList.add("success", "visible");
            } else {
                ball.textContent = "✕";
                ball.classList.add("error", "visible");
            }
        } else {
            // Esconde a bolinha e devolve o cursor
            ball.classList.remove("visible");
            document.documentElement.classList.remove("nikolas-hide-cursor");
        }

        ball.style.left = mouseX + "px";
        ball.style.top = mouseY + "px";
    }

    // =========================================================
    // UTILITÁRIOS
    // =========================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function cleanText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function validKey(key) {
        return key && !key.includes("CHAVE_GEMINI") && !key.includes("SUA_CHAVE") && key.length > 20;
    }

    function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Timeout na requisição."));
            }, timeout);

            fetch(url, { ...options, signal: controller.signal })
                .then(res => {
                    clearTimeout(timer);
                    resolve(res);
                })
                .catch(err => {
                    clearTimeout(timer);
                    if (err.name === "AbortError") reject(new Error("Timeout na requisição."));
                    else reject(err);
                });
        });
    }

    // =========================================================
    // EXTRAÇÃO DA QUESTÃO
    // =========================================================
    function getBodyLines() {
        return document.body.innerText.split("\n").map(cleanText).filter(Boolean);
    }

    function extractActivityQuestion() {
        const lines = getBodyLines();
        const ignored = new Set([
            "Eliminador de Respostas", "Leitor de linha", "Marca texto",
            "Configurações", "Tela cheia", "Próximo"
        ]);

        const cleaned = lines.filter(x => !ignored.has(x));

        let start = cleaned.findIndex(x =>
            /^Question text:$/i.test(x) || /^Texto da questão:$/i.test(x)
        );

        if (start === -1) {
            start = cleaned.findIndex(x => x.toLowerCase().includes("question text:"));
        }

        if (start === -1) return null;

        const questionLines = [];
        const options = [];
        let i = start + 1;

        while (i < cleaned.length) {
            const line = cleaned[i];
            if (/^[A-H]$/.test(line)) break;
            if (/^Questão \d+ de \d+$/i.test(line) || /^Question \d+ of \d+$/i.test(line)) break;
            questionLines.push(line);
            i++;
        }

        while (i < cleaned.length) {
            const letter = cleaned[i];
            if (!/^[A-H]$/.test(letter)) {
                i++;
                continue;
            }
            const next = cleaned[i + 1];
            if (!next || /^[A-H]$/.test(next) ||
                /^Questão \d+ de \d+$/i.test(next) ||
                /^Question \d+ of \d+$/i.test(next)) {
                i++;
                continue;
            }
            options.push({ letter, text: next });
            i += 2;
            if (options.length >= 8) break;
        }

        const questionText = cleanText(questionLines.join(" "));
        if (!questionText) return null;

        return { questionText, options };
    }

    function extractTraditionalQuestion() {
        const el = document.querySelector("#questionText");
        if (!el) return null;

        const questionText = cleanText(el.innerText);
        const optionElements = document.querySelectorAll(".option.is-selectable");

        const options = Array.from(optionElements).map((el, index) => ({
            letter: String.fromCharCode(65 + index),
            text: cleanText(el.querySelector("#optionText")?.innerText || el.innerText)
        })).filter(x => x.text);

        if (!questionText) return null;
        return { questionText, options };
    }

    function extractQuestion() {
        return extractTraditionalQuestion() || extractActivityQuestion();
    }

    // =========================================================
    // PROMPT (agora pede letra + texto da alternativa)
    // =========================================================
    function buildPrompt(data) {
        const optionsText = data.options.length
            ? data.options.map(o => `${o.letter}) ${o.text}`).join("\n")
            : "Não foram detectadas alternativas.";

        return `
Você é um professor especialista.
Analise a questão abaixo e responda EXATAMENTE neste formato:

RESPOSTA:
[letra] - [texto completo da alternativa correta]

RESOLUÇÃO:
[explicação completa e clara do porquê essa é a resposta]

Exemplo de como deve ser a RESPOSTA:
A - 4

QUESTÃO:
${data.questionText}

ALTERNATIVAS:
${optionsText}
`;
    }

    // =========================================================
    // GEMINI
    // =========================================================
    async function askGemini(data) {
        const prompt = buildPrompt(data);
        let lastError = null;

        if (!GEMINI_API_KEYS.length) {
            throw new Error("Nenhuma chave Gemini configurada.");
        }

        for (let keyAttempt = 0; keyAttempt < GEMINI_API_KEYS.length; keyAttempt++) {
            const index = (currentKeyIndex + keyAttempt) % GEMINI_API_KEYS.length;
            const key = GEMINI_API_KEYS[index];

            if (!validKey(key)) continue;

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

            for (let retry = 0; retry <= MAX_RETRIES_PER_KEY; retry++) {
                try {
                    const response = await fetchWithTimeout(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                temperature: 0.1,
                                maxOutputTokens: 1100
                            }
                        })
                    });

                    if (response.ok) {
                        const json = await response.json();
                        const text = json?.candidates?.[0]?.content?.parts
                            ?.map(p => p.text || "").join("").trim();

                        if (text) {
                            currentKeyIndex = index;
                            return text;
                        }
                        throw new Error("Gemini retornou resposta vazia.");
                    }

                    let errorMessage = `HTTP ${response.status}`;
                    try {
                        const errorJson = await response.json();
                        errorMessage = errorJson?.error?.message || errorMessage;
                    } catch (_) {}

                    lastError = new Error(errorMessage);

                    const retryable = [429, 500, 502, 503, 504].includes(response.status);
                    if (retryable && retry < MAX_RETRIES_PER_KEY) {
                        await sleep(2500 * Math.pow(2, retry));
                        continue;
                    }
                    break;

                } catch (error) {
                    lastError = error;
                    const temporary = /timeout|network|fetch/i.test(error.message);
                    if (temporary && retry < MAX_RETRIES_PER_KEY) {
                        await sleep(2500 * Math.pow(2, retry));
                    }
                }
            }
        }

        throw lastError || new Error("Todas as chaves Gemini falharam.");
    }

    // =========================================================
    // SEPARAR RESPOSTA
    // =========================================================
    function parseAIResponse(text) {
        const clean = String(text || "").trim();

        let fullAnswer = "";
        let resolution = clean;

        // Tenta pegar no formato: A - 4
        const matchAnswer = clean.match(/RESPOSTA:\s*([A-H]\s*-\s*.+?)(?:\n|$)/i);
        if (matchAnswer) {
            fullAnswer = cleanText(matchAnswer[1]);
        }

        // Fallback: tenta achar "A - algo"
        if (!fullAnswer) {
            const fallback = clean.match(/\b([A-H]\s*-\s*[^\n]+)/i);
            if (fallback) fullAnswer = cleanText(fallback[1]);
        }

        // Último fallback: só a letra
        if (!fullAnswer) {
            const letterOnly = clean.match(/\b([A-H])\b/);
            fullAnswer = letterOnly ? letterOnly[1].toUpperCase() : "?";
        }

        // Resolução
        const matchRes = clean.match(/RESOLUÇÃO:\s*([\s\S]*)/i);
        if (matchRes) {
            resolution = cleanText(matchRes[1]);
        }

        return { fullAnswer, resolution };
    }

    // =========================================================
    // CONSOLE
    // =========================================================
    function printConsoleResolution(data, resolution, fullAnswer) {
        console.clear();
        console.log("%c NIKOLAS SCRIPTS ", `
            background:#06151c;
            color:#00ff88;
            font-size:16px;
            font-weight:bold;
            padding:6px 12px;
            border:1px solid #00ff88;
            border-radius:6px;
        `);
        console.log("");
        console.log("%cQUESTÃO", "color:#00ffff;font-weight:bold;font-size:13px;");
        console.log(data.questionText);
        console.log("");
        console.log("%cRESPOSTA → " + fullAnswer, "color:#00ff88;font-weight:bold;font-size:14px;");
        console.log("");
        console.log("%cRESOLUÇÃO DETALHADA", "color:#00ff88;font-weight:bold;font-size:13px;");
        console.log(resolution);
        console.log("");
        console.log("%c────────────────────────────────────────", "color:#555;");
        console.log("%cNikolas Scripts • v51.8", "color:#888;font-size:11px;");
    }

    // =========================================================
    // RESULTADO NA TELA
    // =========================================================
    function showResult(fullAnswer, success = true) {
        const old = document.getElementById(RESULT_ID);
        if (old) old.remove();

        const box = document.createElement("div");
        box.id = RESULT_ID;
        if (!success) box.classList.add("error");

        const header = document.createElement("div");
        header.className = "nikolas-result-header";

        const dot = document.createElement("span");
        dot.className = "nikolas-result-dot";
        if (!success) dot.style.background = "#ff3355";

        const headerText = document.createElement("span");
        headerText.textContent = success ? "RESPOSTA" : "ERRO";

        header.appendChild(dot);
        header.appendChild(headerText);

        const text = document.createElement("div");
        text.className = "nikolas-result-text";
        text.textContent = success ? fullAnswer : "Não foi possível analisar";

        const hint = document.createElement("div");
        hint.className = "nikolas-result-hint";
        hint.textContent = success
            ? "Resolução completa no console (F12)"
            : "Veja o console (F12) para detalhes";

        box.appendChild(header);
        box.appendChild(text);
        box.appendChild(hint);
        document.body.appendChild(box);

        setTimeout(() => {
            if (box.isConnected) {
                box.style.opacity = "0";
                box.style.transform = "translateX(-50%) translateY(10px)";
                box.style.transition = "opacity .22s ease, transform .22s ease";
                setTimeout(() => box.remove(), 250);
            }
        }, 7500);
    }

    // =========================================================
    // EXECUÇÃO
    // =========================================================
    async function analyze() {
        if (busy) return;
        busy = true;

        setBallStatus("loading");

        try {
            const data = extractQuestion();
            if (!data) throw new Error("Não consegui detectar a questão.");

            const raw = await askGemini(data);
            const parsed = parseAIResponse(raw);

            printConsoleResolution(data, parsed.resolution, parsed.fullAnswer);
            showResult(parsed.fullAnswer, true);

            setBallStatus("success");
            await sleep(1500);

        } catch (error) {
            console.error("[Nikolas] ERRO:", error);
            showResult(null, false);
            setBallStatus("error");
            await sleep(1500);
        } finally {
            setBallStatus("normal"); // devolve o cursor
            busy = false;
        }
    }

    // =========================================================
    // TECLA ESPAÇO
    // =========================================================
    document.addEventListener("keydown", event => {
        if (event.code !== "Space") return;

        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        event.preventDefault();
        analyze();
    }, true);

    // =========================================================
    // INICIALIZAÇÃO
    // =========================================================
    function init() {
        injectStyle();
        console.log("%c[Nikolas v51.8] Carregado!", "color:#00ff88;font-size:14px;font-weight:bold;");
        console.log("%cPressione ESPAÇO para analisar.", "color:#00ffff;font-weight:bold;");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
