// ==UserScript==
// @name         Nikolas Quizizz v51.5 - Study Mode
// @version      51.5
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
    // IDs
    // =========================================================

    const STYLE_ID = "nikolas-v515-style";
    const CURSOR_ID = "nikolas-v515-cursor";
    const RESULT_ID = "nikolas-v515-result";

    // =========================================================
    // ESTILO
    // =========================================================

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;

        style.textContent = `
            /*
             * CURSOR REALMENTE SUBSTITUÍDO
             */

            html.nikolas-v515-custom-cursor,
            html.nikolas-v515-custom-cursor *,
            html.nikolas-v515-custom-cursor button,
            html.nikolas-v515-custom-cursor a,
            html.nikolas-v515-custom-cursor input,
            html.nikolas-v515-custom-cursor textarea,
            html.nikolas-v515-custom-cursor select {
                cursor: none !important;
            }

            #${CURSOR_ID} {
                position: fixed;
                left: 0;
                top: 0;

                width: 32px;
                height: 40px;

                pointer-events: none;
                user-select: none;

                z-index: 2147483647;

                opacity: 0;

                transform:
                    translate3d(
                        0,
                        0,
                        0
                    );

                transition:
                    opacity .15s ease,
                    filter .2s ease;
            }

            #${CURSOR_ID} svg {
                width: 32px;
                height: 40px;

                display: block;

                overflow: visible;

                transition:
                    transform .18s ease,
                    filter .2s ease;
            }

            #${CURSOR_ID}.visible {
                opacity: 1;
            }

            /*
             * CURSOR NORMAL
             */

            #${CURSOR_ID}.normal svg {
                filter:
                    drop-shadow(0 0 3px rgba(0,255,255,.65))
                    drop-shadow(0 0 8px rgba(0,255,255,.25));
            }

            /*
             * CARREGANDO
             */

            #${CURSOR_ID}.loading svg {
                transform: scale(1.08);
                filter:
                    drop-shadow(0 0 5px #00ffff)
                    drop-shadow(0 0 13px #00ffff)
                    drop-shadow(0 0 25px rgba(0,255,255,.55));
            }

            #${CURSOR_ID}.loading .cursor-arrow {
                opacity: .35;
            }

            #${CURSOR_ID}.loading .cursor-loader {
                opacity: 1;
                animation:
                    nikolasCursorSpin
                    .8s linear infinite;
                transform-origin: 16px 20px;
            }

            /*
             * SUCESSO
             */

            #${CURSOR_ID}.success svg {
                transform: scale(1.12);
                filter:
                    drop-shadow(0 0 5px #00ff88)
                    drop-shadow(0 0 14px #00ff88)
                    drop-shadow(0 0 28px rgba(0,255,136,.6));
            }

            #${CURSOR_ID}.success .cursor-check {
                opacity: 1;
                animation:
                    nikolasCheck
                    .35s ease-out;
            }

            /*
             * ERRO
             */

            #${CURSOR_ID}.error svg {
                transform: scale(1.12);
                filter:
                    drop-shadow(0 0 5px #ff3355)
                    drop-shadow(0 0 14px #ff3355)
                    drop-shadow(0 0 28px rgba(255,51,85,.6));
            }

            #${CURSOR_ID}.error .cursor-error {
                opacity: 1;
                animation:
                    nikolasError
                    .35s ease-out;
            }

            /*
             * RESULTADO
             */

            #${RESULT_ID} {
                position: fixed;

                left: 50%;
                bottom: 34px;

                transform:
                    translateX(-50%)
                    translateY(15px);

                width:
                    min(520px, calc(100vw - 40px));

                box-sizing: border-box;

                padding: 15px 18px;

                border-radius: 14px;

                background:
                    linear-gradient(
                        135deg,
                        rgba(8,14,21,.97),
                        rgba(10,22,29,.96)
                    );

                border:
                    1px solid rgba(0,255,255,.35);

                box-shadow:
                    0 8px 35px rgba(0,0,0,.35),
                    0 0 25px rgba(0,255,255,.08);

                color: #fff;

                font-family:
                    Inter,
                    Poppins,
                    Arial,
                    sans-serif;

                z-index: 2147483646;

                opacity: 0;

                animation:
                    nikolasResultIn
                    .25s ease-out
                    forwards;
            }

            #${RESULT_ID}.success {
                border-color:
                    rgba(0,255,136,.42);

                box-shadow:
                    0 8px 35px rgba(0,0,0,.35),
                    0 0 25px rgba(0,255,136,.08);
            }

            #${RESULT_ID}.error {
                border-color:
                    rgba(255,51,85,.45);

                box-shadow:
                    0 8px 35px rgba(0,0,0,.35),
                    0 0 25px rgba(255,51,85,.08);
            }

            .nikolas-result-header {
                display: flex;
                align-items: center;
                gap: 9px;

                margin-bottom: 7px;

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

                background: #00ffff;

                box-shadow:
                    0 0 8px #00ffff;
            }

            .nikolas-result-text {
                font-size: 15px;
                line-height: 1.45;
                font-weight: 600;
            }

            .nikolas-result-hint {
                margin-top: 7px;

                font-size: 11px;

                color:
                    rgba(255,255,255,.48);
            }

            @keyframes nikolasCursorSpin {
                from {
                    transform: rotate(0deg);
                }

                to {
                    transform: rotate(360deg);
                }
            }

            @keyframes nikolasCheck {
                from {
                    opacity: 0;
                    transform: scale(.5);
                }

                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }

            @keyframes nikolasError {
                0%, 100% {
                    transform: translateX(0);
                }

                25% {
                    transform: translateX(-3px);
                }

                75% {
                    transform: translateX(3px);
                }
            }

            @keyframes nikolasResultIn {
                from {
                    opacity: 0;
                    transform:
                        translateX(-50%)
                        translateY(15px);
                }

                to {
                    opacity: 1;
                    transform:
                        translateX(-50%)
                        translateY(0);
                }
            }
        `;

        document.head.appendChild(style);
    }

    // =========================================================
    // CURSOR CUSTOMIZADO
    // =========================================================

    let mouseX = 0;
    let mouseY = 0;

    function createCursor() {
        let cursor =
            document.getElementById(CURSOR_ID);

        if (cursor) return cursor;

        cursor =
            document.createElement("div");

        cursor.id = CURSOR_ID;

        cursor.innerHTML = `
            <svg
                viewBox="0 0 32 40"
                xmlns="http://www.w3.org/2000/svg"
            >

                <!-- Seta principal -->
                <path
                    class="cursor-arrow"
                    d="
                        M3 2
                        L3 29
                        L10 22
                        L16 36
                        L21 33
                        L15 20
                        L27 20
                        Z
                    "
                    fill="#07151c"
                    stroke="#00ffff"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                />

                <!-- Anel de carregamento -->
                <circle
                    class="cursor-loader"
                    cx="16"
                    cy="20"
                    r="12"
                    fill="none"
                    stroke="#00ffff"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-dasharray="8 6"
                    opacity="0"
                />

                <!-- Check -->
                <path
                    class="cursor-check"
                    d="M8 19 L13 24 L23 13"
                    fill="none"
                    stroke="#00ff88"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0"
                />

                <!-- X -->
                <path
                    class="cursor-error"
                    d="M10 14 L22 26 M22 14 L10 26"
                    fill="none"
                    stroke="#ff3355"
                    stroke-width="3"
                    stroke-linecap="round"
                    opacity="0"
                />

            </svg>
        `;

        document.body.appendChild(cursor);

        return cursor;
    }

    function moveCursor() {
        const cursor =
            document.getElementById(CURSOR_ID);

        if (!cursor) return;

        cursor.style.transform =
            `translate3d(
                ${mouseX + 1}px,
                ${mouseY + 1}px,
                0
            )`;
    }

    document.addEventListener(
        "mousemove",
        event => {
            mouseX = event.clientX;
            mouseY = event.clientY;

            moveCursor();
        },
        true
    );

    function setCursorStatus(type) {
        const cursor =
            createCursor();

        cursor.classList.remove(
            "normal",
            "loading",
            "success",
            "error"
        );

        if (type === "normal") {
            cursor.classList.add(
                "normal",
                "visible"
            );
            return;
        }

        cursor.classList.add(
            type,
            "visible"
        );
    }

    function enableCustomCursor() {
        document.documentElement
            .classList
            .add(
                "nikolas-v515-custom-cursor"
            );

        const cursor =
            createCursor();

        cursor.classList.add(
            "normal",
            "visible"
        );
    }

    function disableCustomCursor() {
        document.documentElement
            .classList
            .remove(
                "nikolas-v515-custom-cursor"
            );

        const cursor =
            document.getElementById(
                CURSOR_ID
            );

        if (cursor) {
            cursor.classList.remove(
                "visible"
            );
        }
    }

    // =========================================================
    // UTILITÁRIOS
    // =========================================================

    const sleep = ms =>
        new Promise(resolve =>
            setTimeout(resolve, ms)
        );

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
        return new Promise(
            (resolve, reject) => {

                const controller =
                    new AbortController();

                const timer =
                    setTimeout(() => {
                        controller.abort();

                        reject(
                            new Error(
                                "Timeout na requisição."
                            )
                        );
                    }, timeout);

                fetch(url, {
                    ...options,
                    signal:
                        controller.signal
                })
                    .then(response => {
                        clearTimeout(timer);
                        resolve(response);
                    })
                    .catch(error => {
                        clearTimeout(timer);

                        if (
                            error.name ===
                            "AbortError"
                        ) {
                            reject(
                                new Error(
                                    "Timeout na requisição."
                                )
                            );
                        } else {
                            reject(error);
                        }
                    });
            }
        );
    }

    // =========================================================
    // EXTRAÇÃO DO LAYOUT NOVO
    // =========================================================

    function getBodyLines() {
        return document.body.innerText
            .split("\n")
            .map(cleanText)
            .filter(Boolean);
    }

    function extractActivityQuestion() {
        const lines =
            getBodyLines();

        const ignored =
            new Set([
                "Eliminador de Respostas",
                "Leitor de linha",
                "Marca texto",
                "Configurações",
                "Tela cheia",
                "Próximo"
            ]);

        const cleaned =
            lines.filter(
                x => !ignored.has(x)
            );

        let start =
            cleaned.findIndex(x =>
                /^Question text:$/i.test(x) ||
                /^Texto da questão:$/i.test(x)
            );

        if (start === -1) {
            start =
                cleaned.findIndex(x =>
                    x.toLowerCase()
                        .includes(
                            "question text:"
                        )
                );
        }

        if (start === -1) {
            console.warn(
                "[Nikolas v51.5] Não encontrei Question text."
            );

            return null;
        }

        const questionLines = [];
        const options = [];

        let i = start + 1;

        while (i < cleaned.length) {
            const line =
                cleaned[i];

            if (/^[A-H]$/.test(line)) {
                break;
            }

            if (
                /^Questão \d+ de \d+$/i
                    .test(line) ||
                /^Question \d+ of \d+$/i
                    .test(line)
            ) {
                break;
            }

            questionLines.push(line);

            i++;
        }

        while (i < cleaned.length) {
            const letter =
                cleaned[i];

            if (!/^[A-H]$/.test(letter)) {
                i++;
                continue;
            }

            const next =
                cleaned[i + 1];

            if (
                !next ||
                /^[A-H]$/.test(next) ||
                /^Questão \d+ de \d+$/i
                    .test(next) ||
                /^Question \d+ of \d+$/i
                    .test(next)
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

        const questionText =
            cleanText(
                questionLines.join(" ")
            );

        if (!questionText) {
            return null;
        }

        console.log(
            "[Nikolas v51.5] Questão:",
            questionText
        );

        console.log(
            "[Nikolas v51.5] Opções:",
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
            document.querySelector(
                "#questionText"
            );

        if (!el) return null;

        const questionText =
            cleanText(
                el.innerText
            );

        const optionElements =
            document.querySelectorAll(
                ".option.is-selectable"
            );

        const options =
            Array.from(optionElements)
                .map((el, index) => ({
                    letter:
                        String.fromCharCode(
                            65 + index
                        ),

                    text:
                        cleanText(
                            el.querySelector(
                                "#optionText"
                            )?.innerText ||
                            el.innerText
                        )
                }))
                .filter(
                    x => x.text
                );

        if (!questionText) {
            return null;
        }

        console.log(
            "[Nikolas v51.5] Layout tradicional detectado."
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
                "[Nikolas v51.5] Layout de atividade detectado."
            );

            return activity;
        }

        return null;
    }

    // =========================================================
    // PROMPT — MODO ESTUDO
    // =========================================================

    function buildPrompt(data) {
        const optionsText =
            data.options.length
                ? data.options
                    .map(o =>
                        `${o.letter}) ${o.text}`
                    )
                    .join("\n")
                : "Não foram detectadas alternativas.";

        return `
Você é um tutor de estudos.

Analise a questão abaixo e ajude o estudante
a compreender o conteúdo e o raciocínio necessário.

IMPORTANTE:
- Não informe a letra de uma alternativa.
- Não diga "A resposta é A/B/C/D".
- Não selecione ou indique diretamente uma alternativa.
- Explique o conceito necessário para resolver.
- Mostre o raciocínio de forma clara.
- Se houver cálculo, mostre o método e as contas.
- Se for português ou inglês, explique a regra.
- Se for história/geografia/ciências, explique o conceito.
- Termine com uma dica curta para o estudante.

FORMATO OBRIGATÓRIO:

CONCLUSÃO CURTA:
[uma frase curta sobre o conceito/resultado que o estudante deve entender]

EXPLICAÇÃO:
[explicação detalhada]

DICA:
[uma dica curta]

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
        const prompt =
            buildPrompt(data);

        let lastError = null;

        if (!GEMINI_API_KEYS.length) {
            throw new Error(
                "Nenhuma chave Gemini configurada."
            );
        }

        for (
            let keyAttempt = 0;
            keyAttempt <
            GEMINI_API_KEYS.length;
            keyAttempt++
        ) {
            const index =
                (
                    currentKeyIndex +
                    keyAttempt
                ) %
                GEMINI_API_KEYS.length;

            const key =
                GEMINI_API_KEYS[index];

            if (!validKey(key)) {
                console.warn(
                    `[Nikolas v51.5] Chave #${index + 1} inválida.`
                );

                continue;
            }

            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

            for (
                let retry = 0;
                retry <=
                MAX_RETRIES_PER_KEY;
                retry++
            ) {
                try {
                    console.log(
                        `[Nikolas v51.5] Gemini chave #${index + 1}, tentativa ${retry + 1}`
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

                                body:
                                    JSON.stringify({
                                        contents: [{
                                            parts: [{
                                                text:
                                                    prompt
                                            }]
                                        }],

                                        generationConfig: {
                                            temperature:
                                                0.2,

                                            maxOutputTokens:
                                                900
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
                                ?.map(
                                    p =>
                                        p.text ||
                                        ""
                                )
                                .join("")
                                .trim();

                        if (text) {
                            currentKeyIndex =
                                index;

                            console.log(
                                "[Nikolas v51.5] Gemini respondeu."
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
                        new Error(
                            errorMessage
                        );

                    console.warn(
                        `[Nikolas v51.5] Gemini #${index + 1}: ${errorMessage}`
                    );

                    const retryable =
                        [
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
                        retry <
                            MAX_RETRIES_PER_KEY
                    ) {
                        const delay =
                            2500 *
                            Math.pow(
                                2,
                                retry
                            );

                        console.log(
                            `[Nikolas v51.5] Retry em ${delay}ms`
                        );

                        await sleep(
                            delay
                        );

                        continue;
                    }

                    break;

                } catch (error) {
                    lastError =
                        error;

                    console.warn(
                        `[Nikolas v51.5] Erro Gemini #${index + 1}:`,
                        error.message
                    );

                    const temporary =
                        /timeout|network|fetch/i
                            .test(
                                error.message
                            );

                    if (
                        temporary &&
                        retry <
                            MAX_RETRIES_PER_KEY
                    ) {
                        const delay =
                            2500 *
                            Math.pow(
                                2,
                                retry
                            );

                        console.log(
                            `[Nikolas v51.5] Nova tentativa em ${delay}ms`
                        );

                        await sleep(
                            delay
                        );
                    }
                }
            }

            console.warn(
                "[Nikolas v51.5] Tentando próxima chave..."
            );
        }

        throw (
            lastError ||
            new Error(
                "Todas as chaves Gemini falharam."
            )
        );
    }

    // =========================================================
    // SEPARAR CONCLUSÃO DA EXPLICAÇÃO
    // =========================================================

    function parseAIResponse(text) {
        const clean =
            String(text || "")
                .trim();

        let conclusion = "";

        const match =
            clean.match(
                /CONCLUSÃO CURTA:\s*([\s\S]*?)(?=\n\s*(?:EXPLICAÇÃO|EXPLICACAO):)/i
            );

        if (match) {
            conclusion =
                cleanText(
                    match[1]
                );
        }

        if (!conclusion) {
            const firstLine =
                clean
                    .split("\n")
                    .map(cleanText)
                    .find(Boolean);

            conclusion =
                firstLine ||
                "Análise concluída.";
        }

        return {
            conclusion,
            fullText: clean
        };
    }

    // =========================================================
    // CONSOLE PROFISSIONAL
    // =========================================================

    function printConsoleExplanation(
        data,
        aiText
    ) {
        console.clear();

        console.log(
            "%c NIKOLAS SCRIPTS ",
            `
                background:#06151c;
                color:#00ffff;
                font-size:16px;
                font-weight:bold;
                padding:6px 12px;
                border:1px solid #00ffff;
                border-radius:6px;
            `
        );

        console.log("");

        console.log(
            "%cQUESTÃO",
            "color:#00ffff;font-weight:bold;font-size:13px;"
        );

        console.log(
            data.questionText
        );

        console.log("");

        console.log(
            "%cEXPLICAÇÃO DETALHADA",
            "color:#00ff88;font-weight:bold;font-size:13px;"
        );

        console.log(
            aiText
        );

        console.log("");

        console.log(
            "%c────────────────────────────────────────",
            "color:#555;"
        );

        console.log(
            "%cNikolas Scripts • Study Mode",
            "color:#888;font-size:11px;"
        );
    }

    // =========================================================
    // RESULTADO PEQUENO NA TELA
    // =========================================================

    function showResult(
        conclusion,
        success = true
    ) {
        const old =
            document.getElementById(
                RESULT_ID
            );

        if (old) {
            old.remove();
        }

        const box =
            document.createElement(
                "div"
            );

        box.id =
            RESULT_ID;

        box.className =
            success
                ? "success"
                : "error";

        const header =
            document.createElement(
                "div"
            );

        header.className =
            "nikolas-result-header";

        const dot =
            document.createElement(
                "span"
            );

        dot.className =
            "nikolas-result-dot";

        const headerText =
            document.createElement(
                "span"
            );

        headerText.textContent =
            success
                ? "ANÁLISE CONCLUÍDA"
                : "ERRO NA ANÁLISE";

        header.appendChild(dot);
        header.appendChild(
            headerText
        );

        const text =
            document.createElement(
                "div"
            );

        text.className =
            "nikolas-result-text";

        text.textContent =
            conclusion;

        const hint =
            document.createElement(
                "div"
            );

        hint.className =
            "nikolas-result-hint";

        hint.textContent =
            success
                ? "Explicação detalhada disponível no console (F12)."
                : "Veja o console (F12) para detalhes do erro.";

        box.appendChild(header);
        box.appendChild(text);
        box.appendChild(hint);

        document.body.appendChild(
            box
        );

        setTimeout(() => {
            if (box.isConnected) {
                box.style.opacity =
                    "0";

                box.style.transform =
                    "translateX(-50%) translateY(8px)";

                box.style.transition =
                    "opacity .25s ease, transform .25s ease";

                setTimeout(() => {
                    box.remove();
                }, 280);
            }
        }, 6500);
    }

    // =========================================================
    // EXECUÇÃO
    // =========================================================

    async function analyze() {
        if (busy) return;

        busy = true;

        setCursorStatus(
            "loading"
        );

        try {
            console.log(
                "%c[Nikolas v51.5] Iniciando análise...",
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
                "[Nikolas v51.5] Questão detectada."
            );

            console.log(
                "[Nikolas v51.5] Enviando para Gemini..."
            );

            const answer =
                await askGemini(
                    data
                );

            const parsed =
                parseAIResponse(
                    answer
                );

            /*
             * Explicação completa somente no console.
             */
            printConsoleExplanation(
                data,
                parsed.fullText
            );

            /*
             * Tela recebe somente
             * a conclusão curta.
             */
            showResult(
                parsed.conclusion,
                true
            );

            setCursorStatus(
                "success"
            );

            console.log(
                "%c[Nikolas v51.5] Concluído.",
                "color:#00ff88;font-weight:bold;"
            );

            await sleep(
                1800
            );

        } catch (error) {

            console.error(
                "[Nikolas v51.5] ERRO:",
                error
            );

            showResult(
                "Não foi possível concluir a análise.",
                false
            );

            setCursorStatus(
                "error"
            );

            await sleep(
                1800
            );

        } finally {

            setCursorStatus(
                "normal"
            );

            busy = false;
        }
    }

    // =========================================================
    // ESPAÇO
    // =========================================================

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.code !==
                "Space"
            ) {
                return;
            }

            const tag =
                document.activeElement
                    ?.tagName;

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

        enableCustomCursor();

        console.log(
            "%c[Nikolas v51.5] Carregado!",
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
