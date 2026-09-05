// ==UserScript==
// @name         Nikolas Quizizz v51.7 - Resposta Completa
// @version      51.7
// @description  Mostra a resposta completa na tela e a resolução no console
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
    const STYLE_ID = "nikolas-v517-style";
    const BALL_ID = "nikolas-v517-ball";
    const RESULT_ID = "nikolas-v517-result";

    // =========================================================
    // ESTILO
    // =========================================================
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            /* Esconde o cursor enquanto a bolinha estiver ativa */
            html.nikolas-hide-cursor,
            html.nikolas-hide-cursor * {
                cursor: none !important;
            }

            #${BALL_ID} {
                position: fixed;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                pointer-events: none;
                z-index: 2147483647;
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.7);
                transition: opacity .18s ease, transform .18s ease, background .2s ease, box-shadow .2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
                font-weight: 700;
                color: white;
                box-shadow: 0 0 0 0 transparent;
            }

            #${BALL_ID}.visible {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
            }

            #${BALL_ID}.loading {
                background: #00c8ff;
                box-shadow: 0 0 12px #00c8ff, 0 0 24px rgba(0,200,255,.4);
                animation: nikolasSpin 0.7s linear infinite;
            }

            #${BALL_ID}.success {
                background: #00d97e;
                box-shadow: 0 0 12px #00d97e, 0 0 24px rgba(0,217,126,.45);
            }

            #${BALL_ID}.error {
                background: #ff3355;
                box-shadow: 0 0 12px #ff3355, 0 0 24px rgba(255,51,85,.45);
            }

            #${RESULT_ID} {
                position: fixed;
                left: 50%;
                bottom: 34px;
                transform: translateX(-50%) translateY(15px);
                width: min(480px, calc(100vw - 40px));
                box-sizing: border-box;
                padding: 16px 20px;
                border-radius: 14px;
                background: linear-gradient(135deg, rgba(8,14,21,.97), rgba(10,22,29,.96));
                border: 1px solid rgba(0,255,136,.4);
                box-shadow: 0 8px 35px rgba(0,0,0,.35), 0 0 25px rgba(0,255,136,.1);
                color: #fff;
                font-family: Inter, Poppins, Arial, sans-serif;
                z-index: 2147483646;
                opacity: 0;
                animation: nikolasResultIn .25s ease-out forwards;
            }

            #${RESULT_ID}.error {
                border-color: rgba(255,51,85,.5);
                box-shadow: 0 8px 35px rgba(0,0,0,.35), 0 0 25px rgba(255,51,85,.1);
            }

            .nikolas-result-header {
                display: flex;
                align-items: center;
                gap: 9px;
                margin-bottom: 6px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .12em;
                text-transform: uppercase;
                opacity: .7;
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
                color: rgba(255,255,255,.5);
            }

            @keyframes nikolasSpin {
                from { transform: translate(-50%, -50%) rotate(0deg); }
                to   { transform: translate(-50%, -50%) rotate(360deg); }
            }

            @keyframes nikolasResultIn {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(15px);
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
    // BOLINHA DE STATUS
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

        if (type === "loading") {
            ball.textContent = "";
            ball.classList.add("loading", "visible");
            document.documentElement.classList.add("nikolas-hide-cursor");
        } 
        else if (type === "success") {
            ball.textContent = "✓";
            ball.classList.add("success", "visible");
            document.documentElement.classList.add("nikolas-hide-cursor");
        } 
        else if (type === "error") {
            ball.textContent = "✕";
            ball.classList.add("error", "visible");
            document.documentElement.classList.add("nikolas-hide-cursor");
        } 
        else {
            // esconde a bolinha e devolve o cursor normal
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
    // PROMPT
    // =========================================================
    function buildPrompt(data) {
        const optionsText = data.options.length
            ? data.options.map(o => `${o.letter}) ${o.text}`).join("\n")
            : "Não foram detectadas alternativas.";

        return `
Você é um professor especialista.
Analise a questão abaixo e responda no formato obrigatório.

FORMATO OBRIGATÓRIO (não invente outros títulos):

RESPOSTA:
[apenas a letra da alternativa correta, ex: B]

RESOLUÇÃO:
[explicação completa, clara e bem escrita do porquê essa é a resposta correta.
Mostre o raciocínio passo a passo. Se tiver cálculo, mostre as contas.
Se for português/inglês, explique a regra. Se for história/ciências, explique o conceito.]

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
                                temperature: 0.15,
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
    // SEPARAR RESPOSTA + PEGAR TEXTO DA ALTERNATIVA
    // =========================================================
    function parseAIResponse(text, options) {
        const clean = String(text || "").trim();

        let letter = "";
        let resolution = clean;

        const matchAnswer = clean.match(/RESPOSTA:\s*([A-H])/i);
        if (matchAnswer) {
            letter = matchAnswer[1].toUpperCase();
        }

        const matchRes = clean.match(/RESOLUÇÃO:\s*([\s\S]*)/i);
        if (matchRes) {
            resolution = cleanText(matchRes[1]);
        }

        if (!letter) {
            const letterMatch = clean.match(/\b([A-H])\b/);
            if (letterMatch) letter = letterMatch[1].toUpperCase();
            else letter = "?";
        }

        // Busca o texto da alternativa correspondente
        let fullAnswer = letter;
        if (options && options.length) {
            const found = options.find(o => o.letter === letter);
            if (found) {
                fullAnswer = `${letter} - ${found.text}`;
            }
        }

        return { letter, fullAnswer, resolution, fullText: clean };
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
        console.log("%cNikolas Scripts • Resposta Completa", "color:#888;font-size:11px;");
    }

    // =========================================================
    // RESULTADO NA TELA
    // =========================================================
    function showResult(fullAnswer, success = true) {
        const old = document.getElementById(RESULT_ID);
        if (old) old.remove();

        const box = document.createElement("div");
        box.id = RESULT_ID;
        box.className = success ? "" : "error";

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
            ? "Resolução completa disponível no console (F12)"
            : "Veja o console (F12) para detalhes do erro";

        box.appendChild(header);
        box.appendChild(text);
        box.appendChild(hint);
        document.body.appendChild(box);

        setTimeout(() => {
            if (box.isConnected) {
                box.style.opacity = "0";
                box.style.transform = "translateX(-50%) translateY(8px)";
                box.style.transition = "opacity .25s ease, transform .25s ease";
                setTimeout(() => box.remove(), 280);
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
            if (!data) throw new Error("Não consegui detectar a questão nesta página.");

            const raw = await askGemini(data);
            const parsed = parseAIResponse(raw, data.options);

            // Console → resolução completa
            printConsoleResolution(data, parsed.resolution, parsed.fullAnswer);

            // Tela → resposta completa (ex: B - Efeito estufa)
            showResult(parsed.fullAnswer, true);

            setBallStatus("success");
            await sleep(1600);

        } catch (error) {
            console.error("[Nikolas] ERRO:", error);
            showResult(null, false);
            setBallStatus("error");
            await sleep(1600);
        } finally {
            setBallStatus("normal"); // esconde bolinha + devolve o cursor
            busy = false;
        }
    }

    // =========================================================
    // ESPAÇO
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
        console.log("%c[Nikolas v51.7] Carregado!", "color:#00ff88;font-size:14px;font-weight:bold;");
        console.log("%cPressione ESPAÇO para analisar a questão.", "color:#00ffff;font-weight:bold;");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
