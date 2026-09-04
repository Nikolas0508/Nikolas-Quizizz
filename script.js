// ==UserScript==
// @name         Nikolas Quizizz v51.3 - Study Mode
// @version      51.3
// @description  Assistente de estudo para Wayground/Quizizz
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
    // UTILITÁRIOS
    // =========================================================

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Timeout na requisição."));
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
                        reject(new Error("Timeout na requisição."));
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

        const cleaned = lines.filter(x => !ignored.has(x));

        let start = cleaned.findIndex(x =>
            /^Question text:$/i.test(x) ||
            /^Texto da questão:$/i.test(x)
        );

        if (start === -1) {
            start = cleaned.findIndex(x =>
                x.toLowerCase().includes("question text:")
            );
        }

        if (start === -1) {
            console.warn("[Nikolas v51.3] Não encontrei 'Question text:'.");
            return null;
        }

        const questionLines = [];
        const options = [];

        let i = start + 1;

        // Texto até começar A/B/C/D...
        while (i < cleaned.length) {
            const line = cleaned[i];

            if (/^[A-H]$/.test(line)) break;

            if (/^Questão \d+ de \d+$/i.test(line)) break;
            if (/^Question \d+ of \d+$/i.test(line)) break;

            questionLines.push(line);
            i++;
        }

        // Procura alternativas
        while (i < cleaned.length) {
            const letter = cleaned[i];

            if (!/^[A-H]$/.test(letter)) {
                i++;
                continue;
            }

            const next = cleaned[i + 1];

            if (!next ||
                /^[A-H]$/.test(next) ||
                /^Questão \d+ de \d+$/i.test(next) ||
                /^Question \d+ of \d+$/i.test(next)) {
                i++;
                continue;
            }

            options.push({
                letter,
                text: next
            });

            i += 2;

            if (options.length >= 8) break;
        }

        const questionText = cleanText(
            questionLines.join(" ")
        );

        if (!questionText) {
            console.warn("[Nikolas v51.3] Texto da questão vazio.");
            return null;
        }

        console.log("[Nikolas v51.3] Questão:", questionText);
        console.log("[Nikolas v51.3] Opções:", options);

        return {
            questionText,
            options
        };
    }

    // =========================================================
    // EXTRAÇÃO TRADICIONAL
    // =========================================================

    function extractTraditionalQuestion() {
        const el = document.querySelector("#questionText");

        if (!el) return null;

        const questionText = cleanText(el.innerText);

        const optionElements = document.querySelectorAll(
            ".option.is-selectable"
        );

        const options = Array.from(optionElements)
            .map((el, index) => ({
                letter: String.fromCharCode(65 + index),
                text: cleanText(
                    el.querySelector("#optionText")?.innerText ||
                    el.innerText
                )
            }))
            .filter(x => x.text);

        if (!questionText) return null;

        console.log(
            "[Nikolas v51.3] Layout tradicional detectado."
        );

        return {
            questionText,
            options
        };
    }

    function extractQuestion() {
        const traditional = extractTraditionalQuestion();

        if (traditional) {
            return traditional;
        }

        const activity = extractActivityQuestion();

        if (activity) {
            console.log(
                "[Nikolas v51.3] Layout de atividade detectado."
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
                .map(o => `${o.letter}) ${o.text}`)
                .join("\n")
            : "Não foram detectadas alternativas.";

        return `
Você é um tutor de estudos.

Analise a questão abaixo e ajude o estudante a ENTENDER o conteúdo.

IMPORTANTE:
- Não informe a letra da alternativa correta.
- Não copie exatamente uma alternativa como resposta.
- Não diga "a resposta é A/B/C/D".
- Explique o conceito necessário para resolver.
- Mostre o raciocínio de forma curta e clara.
- Se for língua portuguesa/inglesa, explique a regra gramatical.
- Se for matemática, mostre o método e as contas necessárias.
- Se for história/geografia/etc., explique o conceito ou fato necessário.
- Termine com uma dica curta para o estudante decidir sozinho.

QUESTÃO:
${data.questionText}

ALTERNATIVAS:
${optionsText}
`;
    }

    async function askGemini(data) {
        const prompt = buildPrompt(data);

        let lastError = null;

        for (let keyAttempt = 0; keyAttempt < GEMINI_API_KEYS.length; keyAttempt++) {

            const index =
                (currentKeyIndex + keyAttempt) %
                GEMINI_API_KEYS.length;

            const key = GEMINI_API_KEYS[index];

            if (!validKey(key)) {
                console.warn(
                    `[Nikolas v51.3] Chave #${index + 1} inválida/placeholder.`
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
                        `[Nikolas v51.3] Gemini chave #${index + 1}, tentativa ${retry + 1}`
                    );

                    const response = await fetchWithTimeout(url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
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
                    });

                    if (response.ok) {
                        const json = await response.json();

                        const text =
                            json?.candidates?.[0]?.content?.parts
                                ?.map(p => p.text || "")
                                .join("")
                                .trim();

                        if (text) {
                            currentKeyIndex = index;

                            console.log(
                                "[Nikolas v51.3] Gemini respondeu com sucesso."
                            );

                            return text;
                        }

                        throw new Error(
                            "Gemini retornou uma resposta vazia."
                        );
                    }

                    let errorMessage = `HTTP ${response.status}`;

                    try {
                        const errorJson = await response.json();

                        errorMessage =
                            errorJson?.error?.message ||
                            errorMessage;
                    } catch (_) {}

                    lastError = new Error(errorMessage);

                    console.warn(
                        `[Nikolas v51.3] Gemini #${index + 1}: ${errorMessage}`
                    );

                    // 429 = limite
                    // 503 = alta demanda/servidor
                    // 500/502/504 = erro temporário
                    const retryable = [
                        429,
                        500,
                        502,
                        503,
                        504
                    ].includes(response.status);

                    if (!retryable) {
                        break;
                    }

                    if (retry < MAX_RETRIES_PER_KEY) {
                        const delay =
                            2500 * Math.pow(2, retry);

                        console.log(
                            `[Nikolas v51.3] Aguardando ${delay}ms antes do retry...`
                        );

                        await sleep(delay);
                    }

                } catch (error) {

                    lastError = error;

                    console.warn(
                        `[Nikolas v51.3] Erro Gemini #${index + 1}:`,
                        error.message
                    );

                    if (
                        retry < MAX_RETRIES_PER_KEY &&
                        /timeout|network|fetch/i.test(error.message)
                    ) {
                        const delay =
                            2500 * Math.pow(2, retry);

                        await sleep(delay);
                    } else if (retry >= MAX_RETRIES_PER_KEY) {
                        break;
                    }
                }
            }

            console.warn(
                `[Nikolas v51.3] Mudando para a próxima chave...`
            );
        }

        throw lastError ||
            new Error("Todas as chaves Gemini falharam.");
    }

    // =========================================================
    // CURSOR / STATUS
    // =========================================================

    function setStatus(type) {
        let cursor = document.getElementById(
            "nikolas-v513-cursor"
        );

        if (!cursor) {
            cursor = document.createElement("div");
            cursor.id = "nikolas-v513-cursor";

            Object.assign(cursor.style, {
                position: "fixed",
                right: "22px",
                bottom: "22px",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                zIndex: "2147483647",
                pointerEvents: "none",
                transition: "all .2s ease"
            });

            document.body.appendChild(cursor);
        }

        if (type === "loading") {
            cursor.style.border =
                "3px solid #00ffff";

            cursor.style.boxShadow =
                "0 0 15px #00ffff";

            cursor.style.background =
                "transparent";

        } else if (type === "success") {

            cursor.style.border =
                "3px solid #00ff88";

            cursor.style.boxShadow =
                "0 0 15px #00ff88";

            cursor.style.background =
                "#00ff88";

        } else if (type === "error") {

            cursor.style.border =
                "3px solid #ff3355";

            cursor.style.boxShadow =
                "0 0 15px #ff3355";

            cursor.style.background =
                "#ff3355";

        } else {

            cursor.style.border = "0";
            cursor.style.boxShadow = "none";
            cursor.style.background = "transparent";
        }
    }

    // =========================================================
    // RESULTADO
    // =========================================================

    function showResult(text) {

        const old = document.getElementById(
            "nikolas-v513-result"
        );

        if (old) old.remove();

        const box = document.createElement("div");

        box.id = "nikolas-v513-result";

        Object.assign(box.style, {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(650px, 85vw)",
            maxHeight: "70vh",
            overflowY: "auto",
            padding: "22px",
            borderRadius: "16px",
            background: "rgba(15,18,25,.96)",
            color: "white",
            zIndex: "2147483646",
            fontFamily: "Inter, Arial, sans-serif",
            boxShadow: "0 0 35px rgba(0,255,255,.25)",
            border: "1px solid rgba(0,255,255,.35)"
        });

        const title = document.createElement("div");

        title.textContent =
            "Nikolas Scripts - Resposta da IA";

        Object.assign(title.style, {
            fontSize: "19px",
            fontWeight: "700",
            marginBottom: "15px"
        });

        const content = document.createElement("div");

        content.innerText = text;

        Object.assign(content.style, {
            whiteSpace: "pre-wrap",
            lineHeight: "1.55",
            fontSize: "15px"
        });

        const close = document.createElement("button");

        close.textContent = "Fechar";

        Object.assign(close.style, {
            marginTop: "18px",
            padding: "9px 16px",
            borderRadius: "8px",
            border: "1px solid rgba(0,255,255,.4)",
            background: "rgba(0,255,255,.1)",
            color: "white",
            cursor: "pointer"
        });

        close.onclick = () => box.remove();

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
        setStatus("loading");

        try {

            console.log(
                "[Nikolas v51.3] Iniciando análise..."
            );

            const data = extractQuestion();

            if (!data) {
                throw new Error(
                    "Não consegui detectar a questão nesta página."
                );
            }

            console.log(
                "[Nikolas v51.3] Enviando para Gemini..."
            );

            const answer = await askGemini(data);

            showResult(answer);

            setStatus("success");

            console.log(
                "[Nikolas v51.3] Análise concluída."
            );

            await sleep(1500);

        } catch (error) {

            console.error(
                "[Nikolas v51.3] ERRO:",
                error
            );

            setStatus("error");

            await sleep(1500);

        } finally {

            setStatus("normal");
            busy = false;
        }
    }

    // =========================================================
    // ESPAÇO = ANALISAR
    // =========================================================

    document.addEventListener("keydown", event => {

        if (event.code !== "Space") return;

        const tag = document.activeElement?.tagName;

        if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT"
        ) {
            return;
        }

        event.preventDefault();

        analyze();
    });

    console.log(
        "%c[Nikolas v51.3] Carregado. Pressione ESPAÇO para analisar.",
        "color:#00ffff;font-weight:bold;"
    );

})();
