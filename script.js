// ==UserScript==
// @name         Nikolas Quizizz v51.4 - Study Mode
// @version      51.4
// @description  Assistente de estudo visual para Wayground/Quizizz
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
    // ESTILO VISUAL
    // =========================================================

    const STYLE_ID = "nikolas-v514-style";

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;

        style.textContent = `
            #nikolas-v514-cursor {
                position: fixed;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                pointer-events: none;
                z-index: 2147483647;
                transform: translate(-50%, -50%);
                opacity: 0;
                transition:
                    width .15s ease,
                    height .15s ease,
                    opacity .15s ease,
                    background .2s ease,
                    border-color .2s ease,
                    box-shadow .2s ease;
            }

            #nikolas-v514-cursor.loading {
                width: 20px;
                height: 20px;
                opacity: 1;
                background: rgba(0,255,255,.15);
                border: 2px solid #00ffff;
                box-shadow:
                    0 0 8px #00ffff,
                    0 0 18px #00ffff,
                    0 0 35px rgba(0,255,255,.7);
                animation: nikolasPulse 1s infinite;
            }

            #nikolas-v514-cursor.success {
                width: 23px;
                height: 23px;
                opacity: 1;
                background: #00ff88;
                border: 2px solid #00ff88;
                box-shadow:
                    0 0 10px #00ff88,
                    0 0 25px #00ff88,
                    0 0 45px rgba(0,255,136,.7);
            }

            #nikolas-v514-cursor.error {
                width: 23px;
                height: 23px;
                opacity: 1;
                background: #ff3355;
                border: 2px solid #ff3355;
                box-shadow:
                    0 0 10px #ff3355,
                    0 0 25px #ff3355,
                    0 0 45px rgba(255,51,85,.7);
            }

            #nikolas-v514-cursor::after {
                content: "";
                position: absolute;
                inset: -8px;
                border-radius: 50%;
                border: 1px solid currentColor;
                opacity: .35;
            }

            #nikolas-v514-cursor.loading::after {
                animation: nikolasSpin 1.2s linear infinite;
            }

            #nikolas-v514-result {
                animation: nikolasResultIn .22s ease-out;
            }

            #nikolas-v514-result::-webkit-scrollbar {
                width: 7px;
            }

            #nikolas-v514-result::-webkit-scrollbar-thumb {
                background: rgba(0,255,255,.35);
                border-radius: 10px;
            }

            @keyframes nikolasPulse {
                0%, 100% {
                    transform: translate(-50%, -50%) scale(1);
                }
                50% {
                    transform: translate(-50%, -50%) scale(1.25);
                }
            }

            @keyframes nikolasSpin {
                from {
                    transform: rotate(0deg);
                }
                to {
                    transform: rotate(360deg);
                }
            }

            @keyframes nikolasResultIn {
                from {
                    opacity: 0;
                    transform: translate(-50%, -47%) scale(.97);
                }
                to {
                    opacity: 1;
                    transform: translate(-50%, -50%) scale(1);
                }
            }
        `;

        document.head.appendChild(style);
    }

    // =========================================================
// CURSOR DE MOUSE NEON
// =========================================================

let mouseX = 0;
let mouseY = 0;

function createCursor() {
    let cursor = document.getElementById(
        "nikolas-v514-mouse"
    );

    if (cursor) return cursor;

    cursor = document.createElement("div");
    cursor.id = "nikolas-v514-mouse";

    Object.assign(cursor.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "0",
        height: "0",
        zIndex: "2147483647",
        pointerEvents: "none",
        opacity: "0",
        transform: "translate(-2px, -2px)"
    });

    // Desenho de seta de mouse
    cursor.innerHTML = `
        <svg
            width="30"
            height="38"
            viewBox="0 0 30 38"
            xmlns="http://www.w3.org/2000/svg"
            style="
                overflow:visible;
                display:block;
                filter:
                    drop-shadow(0 0 3px #00ffff)
                    drop-shadow(0 0 8px #00ffff);
            "
        >
            <path
                id="nikolas-cursor-path"
                d="M3 2 L3 30 L10 23 L16 36 L21 33 L15 21 L26 21 Z"
                fill="#06151b"
                stroke="#00ffff"
                stroke-width="2"
                stroke-linejoin="round"
            />
        </svg>
    `;

    document.body.appendChild(cursor);

    return cursor;
}

document.addEventListener("mousemove", event => {
    mouseX = event.clientX;
    mouseY = event.clientY;

    const cursor = document.getElementById(
        "nikolas-v514-mouse"
    );

    if (!cursor) return;

    cursor.style.left = `${mouseX}px`;
    cursor.style.top = `${mouseY}px`;
}, true);

function setCursorStatus(type) {
    const cursor = createCursor();

    const path = cursor.querySelector(
        "#nikolas-cursor-path"
    );

    if (!path) return;

    cursor.style.opacity = "1";

    if (type === "loading") {

        path.setAttribute(
            "stroke",
            "#00ffff"
        );

        path.setAttribute(
            "fill",
            "#06151b"
        );

        cursor.style.filter =
            "drop-shadow(0 0 5px #00ffff) " +
            "drop-shadow(0 0 14px #00ffff)";

    } else if (type === "success") {

        path.setAttribute(
            "stroke",
            "#00ff88"
        );

        path.setAttribute(
            "fill",
            "#062015"
        );

        cursor.style.filter =
            "drop-shadow(0 0 5px #00ff88) " +
            "drop-shadow(0 0 14px #00ff88)";

    } else if (type === "error") {

        path.setAttribute(
            "stroke",
            "#ff3355"
        );

        path.setAttribute(
            "fill",
            "#20060d"
        );

        cursor.style.filter =
            "drop-shadow(0 0 5px #ff3355) " +
            "drop-shadow(0 0 14px #ff3355)";

    } else {

        cursor.style.opacity = "0";
    }
}

    // =========================================================
    // UTILITÁRIOS
    // =========================================================

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    function cleanText(text) {
        return String(text || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function validKey(key) {
        return key &&
            !key.includes("CHAVE_GEMINI") &&
            !key.includes("SUA_CHAVE") &&
            key.length > 20;
    }

    function fetchWithTimeout(
        url,
        options,
        timeout = REQUEST_TIMEOUT
    ) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();

            const timer = setTimeout(() => {
                controller.abort();
                reject(
                    new Error("Timeout na requisição.")
                );
            }, timeout);

            fetch(url, {
                ...options,
                signal: controller.signal
            })
                .then(response => {
                    clearTimeout(timer);
                    resolve(response);
                })
                .catch(error => {
                    clearTimeout(timer);

                    if (error.name === "AbortError") {
                        reject(
                            new Error(
                                "Timeout na requisição."
                            )
                        );
                    } else {
                        reject(error);
                    }
                });
        });
    }

    // =========================================================
    // EXTRAÇÃO DO LAYOUT NOVO
    // =========================================================

    function getBodyLines() {
        return document.body.innerText
            .split("\n")
            .map(x => cleanText(x))
            .filter(Boolean);
    }

    function extractActivityQuestion() {
        const lines = getBodyLines();

        const ignored = new Set([
            "Eliminador de Respostas",
            "Leitor de linha",
            "Marca texto",
            "Configurações",
            "Tela cheia",
            "Próximo"
        ]);

        const cleaned = lines.filter(
            x => !ignored.has(x)
        );

        let start = cleaned.findIndex(x =>
            /^Question text:$/i.test(x) ||
            /^Texto da questão:$/i.test(x)
        );

        if (start === -1) {
            start = cleaned.findIndex(x =>
                x.toLowerCase().includes(
                    "question text:"
                )
            );
        }

        if (start === -1) {
            console.warn(
                "[Nikolas v51.4] Não encontrei Question text."
            );

            return null;
        }

        const questionLines = [];
        const options = [];

        let i = start + 1;

        while (i < cleaned.length) {
            const line = cleaned[i];

            if (/^[A-H]$/.test(line)) {
                break;
            }

            if (
                /^Questão \d+ de \d+$/i.test(line) ||
                /^Question \d+ of \d+$/i.test(line)
            ) {
                break;
            }

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

            if (
                !next ||
                /^[A-H]$/.test(next) ||
                /^Questão \d+ de \d+$/i.test(next) ||
                /^Question \d+ of \d+$/i.test(next)
            ) {
                i++;
                continue;
            }

            options.push({
                letter,
                text: next
            });

            i += 2;

            if (options.length >= 8) {
                break;
            }
        }

        const questionText = cleanText(
            questionLines.join(" ")
        );

        if (!questionText) {
            return null;
        }

        console.log(
            "[Nikolas v51.4] Questão:",
            questionText
        );

        console.log(
            "[Nikolas v51.4] Opções:",
            options
        );

        return {
            questionText,
            options
        };
    }

    // =========================================================
    // EXTRAÇÃO TRADICIONAL
    // =========================================================

    function extractTraditionalQuestion() {
        const el =
            document.querySelector("#questionText");

        if (!el) return null;

        const questionText =
            cleanText(el.innerText);

        const optionElements =
            document.querySelectorAll(
                ".option.is-selectable"
            );

        const options =
            Array.from(optionElements)
                .map((el, index) => ({
                    letter:
                        String.fromCharCode(65 + index),

                    text: cleanText(
                        el.querySelector(
                            "#optionText"
                        )?.innerText ||
                        el.innerText
                    )
                }))
                .filter(x => x.text);

        if (!questionText) {
            return null;
        }

        console.log(
            "[Nikolas v51.4] Layout tradicional detectado."
        );

        return {
            questionText,
            options
        };
    }

    function extractQuestion() {
        const traditional =
            extractTraditionalQuestion();

        if (traditional) {
            return traditional;
        }

        const activity =
            extractActivityQuestion();

        if (activity) {
            console.log(
                "[Nikolas v51.4] Layout de atividade detectado."
            );

            return activity;
        }

        return null;
    }

    // =========================================================
    // GEMINI
    // =========================================================

    function buildPrompt(data) {
        const optionsText = data.options.length
            ? data.options
                .map(o =>
                    `${o.letter}) ${o.text}`
                )
                .join("\n")
            : "Não foram detectadas alternativas.";

        return `
Você é um tutor de estudos.

Ajude o estudante a ENTENDER como resolver a questão.

REGRAS:
- Não informe a letra da alternativa correta.
- Não diga "a resposta é A/B/C/D".
- Não copie uma alternativa como resposta.
- Explique o conceito necessário.
- Mostre um raciocínio curto e claro.
- Em português/inglês, explique a regra gramatical.
- Em matemática, explique o método e as contas.
- Em história/geografia/etc., explique o conceito.
- Termine com uma dica para o estudante decidir sozinho.

QUESTÃO:
${data.questionText}

ALTERNATIVAS:
${optionsText}
`;
    }

    async function askGemini(data) {
        const prompt = buildPrompt(data);

        let lastError = null;

        if (!GEMINI_API_KEYS.length) {
            throw new Error(
                "Nenhuma chave Gemini configurada."
            );
        }

        for (
            let keyAttempt = 0;
            keyAttempt < GEMINI_API_KEYS.length;
            keyAttempt++
        ) {
            const index =
                (currentKeyIndex + keyAttempt) %
                GEMINI_API_KEYS.length;

            const key =
                GEMINI_API_KEYS[index];

            if (!validKey(key)) {
                console.warn(
                    `[Nikolas v51.4] Chave #${index + 1} inválida.`
                );

                continue;
            }

            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

            for (
                let retry = 0;
                retry <= MAX_RETRIES_PER_KEY;
                retry++
            ) {
                try {
                    console.log(
                        `[Nikolas v51.4] Gemini chave #${index + 1}, tentativa ${retry + 1}`
                    );

                    const response =
                        await fetchWithTimeout(
                            url,
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body: JSON.stringify({
                                    contents: [{
                                        parts: [{
                                            text: prompt
                                        }]
                                    }],

                                    generationConfig: {
                                        temperature: 0.2,
                                        maxOutputTokens: 700
                                    }
                                })
                            }
                        );

                    if (response.ok) {
                        const json =
                            await response.json();

                        const text =
                            json
                                ?.candidates?.[0]
                                ?.content?.parts
                                ?.map(p =>
                                    p.text || ""
                                )
                                .join("")
                                .trim();

                        if (text) {
                            currentKeyIndex = index;

                            console.log(
                                "[Nikolas v51.4] Gemini respondeu."
                            );

                            return text;
                        }

                        throw new Error(
                            "Gemini retornou resposta vazia."
                        );
                    }

                    let errorMessage =
                        `HTTP ${response.status}`;

                    try {
                        const errorJson =
                            await response.json();

                        errorMessage =
                            errorJson
                                ?.error?.message ||
                            errorMessage;
                    } catch (_) {}

                    lastError =
                        new Error(errorMessage);

                    console.warn(
                        `[Nikolas v51.4] Gemini #${index + 1}: ${errorMessage}`
                    );

                    const retryable = [
                        429,
                        500,
                        502,
                        503,
                        504
                    ].includes(
                        response.status
                    );

                    if (
                        retryable &&
                        retry < MAX_RETRIES_PER_KEY
                    ) {
                        const delay =
                            2500 *
                            Math.pow(2, retry);

                        console.log(
                            `[Nikolas v51.4] Retry em ${delay}ms`
                        );

                        await sleep(delay);

                        continue;
                    }

                    break;

                } catch (error) {
                    lastError = error;

                    console.warn(
                        `[Nikolas v51.4] Erro Gemini #${index + 1}:`,
                        error.message
                    );

                    const temporary =
                        /timeout|network|fetch/i
                            .test(error.message);

                    if (
                        temporary &&
                        retry < MAX_RETRIES_PER_KEY
                    ) {
                        const delay =
                            2500 *
                            Math.pow(2, retry);

                        console.log(
                            `[Nikolas v51.4] Nova tentativa em ${delay}ms`
                        );

                        await sleep(delay);
                    }
                }
            }

            console.warn(
                `[Nikolas v51.4] Tentando próxima chave...`
            );
        }

        throw lastError ||
            new Error(
                "Todas as chaves Gemini falharam."
            );
    }

    // =========================================================
    // RESULTADO
    // =========================================================

    function showResult(text) {
        const old =
            document.getElementById(
                "nikolas-v514-result"
            );

        if (old) {
            old.remove();
        }

        const box =
            document.createElement("div");

        box.id =
            "nikolas-v514-result";

        Object.assign(box.style, {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform:
                "translate(-50%, -50%)",

            width:
                "min(650px, 85vw)",

            maxHeight: "70vh",
            overflowY: "auto",

            padding: "24px",

            borderRadius: "18px",

            background:
                "rgba(10,15,22,.97)",

            color: "white",

            zIndex: "2147483646",

            fontFamily:
                "Inter, Arial, sans-serif",

            boxShadow:
                "0 0 20px rgba(0,255,255,.25), 0 0 60px rgba(0,255,255,.08)",

            border:
                "1px solid rgba(0,255,255,.4)"
        });

        const title =
            document.createElement("div");

        title.textContent =
            "Nikolas Scripts - Resposta da IA";

        Object.assign(title.style, {
            fontSize: "20px",
            fontWeight: "700",
            marginBottom: "17px",
            color: "#00ffff",
            textShadow:
                "0 0 10px rgba(0,255,255,.6)"
        });

        const content =
            document.createElement("div");

        content.innerText = text;

        Object.assign(content.style, {
            whiteSpace: "pre-wrap",
            lineHeight: "1.6",
            fontSize: "15px"
        });

        const close =
            document.createElement("button");

        close.textContent = "Fechar";

        Object.assign(close.style, {
            marginTop: "20px",
            padding: "10px 18px",
            borderRadius: "9px",
            border:
                "1px solid rgba(0,255,255,.45)",
            background:
                "rgba(0,255,255,.08)",
            color: "white",
            cursor: "pointer",
            fontWeight: "600"
        });

        close.onmouseenter = () => {
            close.style.background =
                "rgba(0,255,255,.18)";

            close.style.boxShadow =
                "0 0 15px rgba(0,255,255,.3)";
        };

        close.onmouseleave = () => {
            close.style.background =
                "rgba(0,255,255,.08)";

            close.style.boxShadow =
                "none";
        };

        close.onclick = () =>
            box.remove();

        box.appendChild(title);
        box.appendChild(content);
        box.appendChild(close);

        document.body.appendChild(box);
    }

    // =========================================================
    // EXECUÇÃO
    // =========================================================

    async function analyze() {
        if (busy) return;

        busy = true;

        setCursorStatus("loading");

        try {
            console.log(
                "%c[Nikolas v51.4] Iniciando análise...",
                "color:#00ffff;font-weight:bold;"
            );

            const data =
                extractQuestion();

            if (!data) {
                throw new Error(
                    "Não consegui detectar a questão nesta página."
                );
            }

            console.log(
                "[Nikolas v51.4] Questão detectada."
            );

            console.log(
                "[Nikolas v51.4] Enviando para Gemini..."
            );

            const answer =
                await askGemini(data);

            showResult(answer);

            setCursorStatus("success");

            console.log(
                "%c[Nikolas v51.4] Concluído.",
                "color:#00ff88;font-weight:bold;"
            );

            await sleep(1800);

        } catch (error) {
            console.error(
                "[Nikolas v51.4] ERRO:",
                error
            );

            setCursorStatus("error");

            await sleep(1800);

        } finally {
            setCursorStatus("normal");
            busy = false;
        }
    }

    // =========================================================
    // TECLA ESPAÇO
    // =========================================================

    document.addEventListener(
        "keydown",
        event => {
            if (event.code !== "Space") {
                return;
            }

            const tag =
                document.activeElement?.tagName;

            if (
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                tag === "SELECT"
            ) {
                return;
            }

            event.preventDefault();

            analyze();
        },
        true
    );

    // =========================================================
    // INICIALIZAÇÃO
    // =========================================================

    function init() {
        injectStyle();
        createCursor();

        console.log(
            "%c[Nikolas v51.4] Carregado!",
            "color:#00ffff;font-size:14px;font-weight:bold;"
        );

        console.log(
            "%cPressione ESPAÇO para analisar.",
            "color:#00ff88;font-weight:bold;"
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            { once: true }
        );
    } else {
        init();
    }

})();
