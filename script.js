// ==UserScript==
// @name         Nikolas Quizizz v52
// @version      52.0
// @description  Assistente de questões: extrai texto/imagens, consulta IA, usa cache e mostra a resposta sem clicar/enviar automaticamente.
// @author       Nikolas
// @match        https://wayground.com/join/game/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /*
     * ============================================================
     * NIKOLAS QUIZIZZ v52
     * ============================================================
     * Melhorias principais:
     * - cache de respostas por questão
     * - detecção de layout mais tolerante
     * - rotação de chaves com tratamento de 401/403/429/5xx
     * - timeout de requisições
     * - suporte a texto e imagens
     * - redução de chamadas duplicadas
     * - interface de status
     * - resposta exibida sem clicar/enviar automaticamente
     * ============================================================
     */

    const CONFIG = {
        provider: 'gemini',

        geminiModel:
            'gemini-2.5-flash',

        openRouterModel:
            'deepseek/deepseek-chat-v3-0324:free',

        requestTimeout:
            30000,

        cacheTtl:
            1000 * 60 * 60 * 6,

        maxQuestionLength:
            12000,

        maxImageBytes:
            4 * 1024 * 1024,

        debug:
            true
    };

    const GEMINI_API_KEYS = [
        // COLOQUE SUAS CHAVES GEMINI AQUI
        ''
    ];

    const OPENROUTER_API_KEYS = [
        // COLOQUE SUAS CHAVES OPENROUTER AQUI
        ''
    ];

    let busy = false;

    let currentGeminiKeyIndex =
        0;

    let currentOpenRouterKeyIndex =
        0;

    let lastQuestionFingerprint =
        '';

    const answerCache =
        new Map();

    function log(
        ...args
    ) {
        if (!CONFIG.debug) return;

        console.log(
            '[Nikolas v52]',
            ...args
        );
    }

    function warn(
        ...args
    ) {
        console.warn(
            '[Nikolas v52]',
            ...args
        );
    }

    function sleep(
        ms
    ) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    function isConfiguredKey(
        key
    ) {
        return (
            typeof key ===
                'string' &&
            key.trim().length >
                10
        );
    }

    function normalizeText(
        text
    ) {
        return String(
            text || ''
        )
            .replace(
                /\s+/g,
                ' '
            )
            .trim();
    }

    function normalizeForFingerprint(
        text
    ) {
        return normalizeText(
            text
        )
            .toLowerCase()
            .replace(
                /[\u200B-\u200D\uFEFF]/g,
                ''
            );
    }

    function getFingerprint(
        quizData
    ) {
        return [
            quizData?.questionType ||
                '',
            normalizeForFingerprint(
                quizData?.questionText ||
                    ''
            ),
            ...(quizData?.options || [])
                .map(
                    option =>
                        normalizeForFingerprint(
                            option?.text ||
                                ''
                        )
                )
        ].join(
            '|'
        );
    }

    function getCachedAnswer(
        fingerprint
    ) {
        const entry =
            answerCache.get(
                fingerprint
            );

        if (!entry) {
            return null;
        }

        if (
            Date.now() -
                entry.timestamp >
            CONFIG.cacheTtl
        ) {
            answerCache.delete(
                fingerprint
            );

            return null;
        }

        return entry.answer;
    }

    function setCachedAnswer(
        fingerprint,
        answer
    ) {
        if (
            !fingerprint ||
            !answer
        ) {
            return;
        }

        answerCache.set(
            fingerprint,
            {
                answer,
                timestamp:
                    Date.now()
            }
        );

        if (
            answerCache.size >
            100
        ) {
            const firstKey =
                answerCache.keys()
                    .next()
                    .value;

            answerCache.delete(
                firstKey
            );
        }
    }

    function getText(
        element
    ) {
        if (!element) {
            return '';
        }

        return normalizeText(
            element.innerText ||
            element.textContent ||
            ''
        );
    }

    function isVisible(
        element
    ) {
        if (!element) {
            return false;
        }

        const style =
            getComputedStyle(
                element
            );

        if (
            style.display ===
                'none' ||
            style.visibility ===
                'hidden' ||
            Number(
                style.opacity
            ) === 0
        ) {
            return false;
        }

        const rect =
            element.getBoundingClientRect();

        return (
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function uniqueElements(
        elements
    ) {
        return [
            ...new Set(
                elements.filter(
                    Boolean
                )
            )
        ];
    }

    function collectTextCandidates() {
        const selectors = [
            '[data-testid*="question"]',
            '[data-testid*="Question"]',
            '[class*="question"]',
            '[class*="Question"]',
            '[class*="prompt"]',
            '[class*="Prompt"]',
            '[aria-label*="question" i]',
            '[aria-label*="Question" i]'
        ];

        const result = [];

        for (
            const selector of
            selectors
        ) {
            try {
                result.push(
                    ...document.querySelectorAll(
                        selector
                    )
                );
            } catch (_) {}
        }

        return uniqueElements(
            result
        ).filter(
            isVisible
        );
    }

    function chooseBestQuestionElement(
        elements
    ) {
        if (
            !elements.length
        ) {
            return null;
        }

        const scored =
            elements.map(
                element => {
                    const text =
                        getText(
                            element
                        );

                    let score =
                        0;

                    if (
                        text.length >=
                        10
                    ) {
                        score +=
                            Math.min(
                                text.length /
                                    20,
                                20
                            );
                    }

                    if (
                        text.length >
                        500
                    ) {
                        score -=
                            5;
                    }

                    const rect =
                        element.getBoundingClientRect();

                    score +=
                        Math.min(
                            rect.width *
                                rect.height /
                                50000,
                            10
                        );

                    if (
                        /question|prompt/i.test(
                            String(
                                element.className ||
                                    ''
                            )
                        )
                    ) {
                        score +=
                            5;
                    }

                    return {
                        element,
                        text,
                        score
                    };
                }
            );

        scored.sort(
            (
                a,
                b
            ) =>
                b.score -
                a.score
        );

        return (
            scored[0]
                ?.element ||
            null
        );
    }

    function extractOptions() {
        const selectors = [
            '[data-testid*="answer"]',
            '[data-testid*="option"]',
            '[class*="answer"]',
            '[class*="Answer"]',
            '[class*="option"]',
            '[class*="Option"]',
            'button'
        ];

        const candidates = [];

        for (
            const selector of
            selectors
        ) {
            try {
                candidates.push(
                    ...document.querySelectorAll(
                        selector
                    )
                );
            } catch (_) {}
        }

        const unique =
            uniqueElements(
                candidates
            ).filter(
                isVisible
            );

        const options = [];

        for (
            const element of
            unique
        ) {
            const text =
                getText(
                    element
                );

            if (
                text.length <
                1 ||
                text.length >
                1000
            ) {
                continue;
            }

            if (
                options.some(
                    item =>
                        normalizeForFingerprint(
                            item.text
                        ) ===
                        normalizeForFingerprint(
                            text
                        )
                )
            ) {
                continue;
            }

            options.push({
                element,
                text
            });
        }

        return options.slice(
            0,
            12
        );
    }

    function detectQuestionType(
        questionText,
        options
    ) {
        const text =
            normalizeForFingerprint(
                questionText
            );

        if (
            !options.length
        ) {
            return 'open';
        }

        if (
            options.length ===
                2 &&
            options.every(
                option =>
                    /^(true|false|verdadeiro|falso|sim|não|nao)$/i.test(
                        normalizeText(
                            option.text
                        )
                    )
            )
        ) {
            return 'true_false';
        }

        if (
            /\b(multiple|multiple choice|mais de uma|selecione todas|marque todas)\b/i.test(
                text
            )
        ) {
            return 'multiple_choice';
        }

        return 'multiple_choice';
    }

    function extractImageUrls() {
        const urls =
            new Set();

        const images =
            document.querySelectorAll(
                'img'
            );

        for (
            const img of
            images
        ) {
            if (
                !isVisible(
                    img
                )
            ) {
                continue;
            }

            const candidates = [
                img.currentSrc,
                img.src,
                img.getAttribute(
                    'data-src'
                ),
                img.getAttribute(
                    'data-lazy-src'
                )
            ];

            for (
                const url of
                candidates
            ) {
                if (
                    typeof url ===
                        'string' &&
                    url.trim()
                ) {
                    urls.add(
                        url.trim()
                    );
                }
            }
        }

        return [
            ...urls
        ];
    }

    async function extrairDadosDaQuestao() {
        const questionElements =
            collectTextCandidates();

        const questionElement =
            chooseBestQuestionElement(
                questionElements
            );

        let questionText =
            getText(
                questionElement
            );

        if (
            questionText.length <
            3
        ) {
            const bodyText =
                getText(
                    document.body
                );

            questionText =
                bodyText.slice(
                    0,
                    CONFIG.maxQuestionLength
                );
        }

        questionText =
            questionText.slice(
                0,
                CONFIG.maxQuestionLength
            );

        const options =
            extractOptions();

        const imageUrls =
            extractImageUrls();

        const questionType =
            detectQuestionType(
                questionText,
                options
            );

        return {
            questionText,
            options,
            imageUrls,
            questionType
        };
    }
                );
        }

        if (data.allAvailableOptions) {
            parts.push(
                data.allAvailableOptions
                    .map(normalizeForMatch)
                    .join('|')
            );
        }

        if (data.draggableOptions) {
            parts.push(
                data.draggableOptions
                    .map(x => normalizeForMatch(x.text))
                    .join('|')
            );
        }

        if (data.draggableItems) {
            parts.push(
                data.draggableItems
                    .map(x =>
                        normalizeForMatch(
                            x.text ||
                            x.id ||
                            x.imageUrl ||
                            ''
                        )
                    )
                    .join('|')
            );
        }

        if (data.dropZones) {
            parts.push(
                data.dropZones
                    .map(x =>
                        normalizeForMatch(
                            x.text ||
                            x.prompt ||
                            ''
                        )
                    )
                    .join('|')
            );
        }

        return parts.join('||');
    }

    function normalizeForMatch(text) {
        return normalizeText(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            )
            .replace(
                /[^\p{L}\p{N}\s]/gu,
                ' '
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim();
    }

    // ============================================================
    // CACHE PERSISTENTE
    // ============================================================

    const STORAGE_CACHE_KEY =
        'nikolas_quizizz_v52_cache';

    function loadPersistentCache() {
        try {
            const raw =
                localStorage.getItem(
                    STORAGE_CACHE_KEY
                );

            if (!raw) return;

            const parsed =
                JSON.parse(raw);

            if (
                !parsed ||
                typeof parsed !==
                    'object'
            ) {
                return;
            }

            for (
                const [key, value] of
                Object.entries(parsed)
            ) {
                if (
                    !value ||
                    typeof value !==
                        'object'
                ) {
                    continue;
                }

                if (
                    Date.now() -
                        Number(
                            value.timestamp ||
                                0
                        ) >
                    CONFIG.cacheTtl
                ) {
                    continue;
                }

                answerCache.set(
                    key,
                    value
                );
            }

            log(
                'Cache persistente carregado:',
                answerCache.size
            );
        } catch (error) {
            warn(
                'Erro ao carregar cache:',
                error
            );
        }
    }

    function savePersistentCache() {
        try {
            const object = {};

            for (
                const [key, value] of
                answerCache.entries()
            ) {
                object[key] = value;
            }

            localStorage.setItem(
                STORAGE_CACHE_KEY,
                JSON.stringify(object)
            );
        } catch (error) {
            warn(
                'Erro ao salvar cache:',
                error
            );
        }
    }

    function getAnswerFromCache(
        fingerprint
    ) {
        if (!fingerprint) {
            return null;
        }

        const memory =
            answerCache.get(
                fingerprint
            );

        if (memory) {
            if (
                Date.now() -
                    memory.timestamp <=
                CONFIG.cacheTtl
            ) {
                return memory.answer;
            }

            answerCache.delete(
                fingerprint
            );
        }

        try {
            const raw =
                localStorage.getItem(
                    STORAGE_CACHE_KEY
                );

            if (!raw) {
                return null;
            }

            const parsed =
                JSON.parse(raw);

            const entry =
                parsed?.[
                    fingerprint
                ];

            if (!entry) {
                return null;
            }

            if (
                Date.now() -
                    Number(
                        entry.timestamp ||
                            0
                    ) >
                CONFIG.cacheTtl
            ) {
                delete parsed[
                    fingerprint
                ];

                localStorage.setItem(
                    STORAGE_CACHE_KEY,
                    JSON.stringify(
                        parsed
                    )
                );

                return null;
            }

            answerCache.set(
                fingerprint,
                entry
            );

            return entry.answer;
        } catch (error) {
            warn(
                'Erro ao consultar cache persistente:',
                error
            );

            return null;
        }
    }

    function saveAnswerToCache(
        fingerprint,
        answer
    ) {
        if (
            !fingerprint ||
            !answer
        ) {
            return;
        }

        const entry = {
            answer,
            timestamp:
                Date.now()
        };

        answerCache.set(
            fingerprint,
            entry
        );

        if (
            answerCache.size >
            150
        ) {
            const first =
                answerCache.keys()
                    .next()
                    .value;

            answerCache.delete(
                first
            );
        }

        savePersistentCache();
    }

    // ============================================================
    // IMAGENS
    // ============================================================

    function imageUrlFromElement(
        element
    ) {
        if (!element) {
            return null;
        }

        if (
            element.tagName ===
            'IMG'
        ) {
            return (
                element.currentSrc ||
                element.src ||
                element.getAttribute(
                    'data-src'
                ) ||
                null
            );
        }

        const image =
            element.querySelector(
                'img'
            );

        if (image) {
            return (
                image.currentSrc ||
                image.src ||
                image.getAttribute(
                    'data-src'
                ) ||
                null
            );
        }

        const style =
            element.getAttribute(
                'style'
            ) || '';

        const match =
            style.match(
                /url\(["']?([^"')]+)["']?\)/i
            );

        return match?.[1] ||
            null;
    }

    function findQuestionImage(
        container
    ) {
        const roots =
            uniqueElements([
                container,
                document
            ]);

        const candidates = [];

        for (
            const root of
            roots
        ) {
            root.querySelectorAll?.(
                'img, [style*="background-image" i]'
            ).forEach(
                element => {
                    if (
                        !isVisible(
                            element
                        )
                    ) {
                        return;
                    }

                    const url =
                        imageUrlFromElement(
                            element
                        );

                    if (!url) {
                        return;
                    }

                    candidates.push({
                        element,
                        url
                    });
                }
            );
        }

        if (!candidates.length) {
            return null;
        }

        const scored =
            candidates.map(
                item => {
                    const rect =
                        item.element.getBoundingClientRect();

                    let score =
                        rect.width *
                        rect.height;

                    const alt =
                        item.element.getAttribute(
                            'alt'
                        ) || '';

                    if (
                        /question|questao|questão|image|imagem/i.test(
                            alt
                        )
                    ) {
                        score +=
                            100000;
                    }

                    return {
                        ...item,
                        score
                    };
                }
            );

        scored.sort(
            (a, b) =>
                b.score -
                a.score
        );

        return scored[0] ||
            null;
    }

    async function imageToDataUrl(
        url
    ) {
        if (!url) {
            return null;
        }

        try {
            const response =
                await fetch(
                    url,
                    {
                        credentials:
                            'include'
                    }
                );

            if (!response.ok) {
                return null;
            }

            const blob =
                await response.blob();

            if (
                blob.size >
                CONFIG.maxImageBytes
            ) {
                warn(
                    'Imagem ignorada por tamanho:',
                    blob.size
                );

                return null;
            }

            return await new Promise(
                resolve => {
                    const reader =
                        new FileReader();

                    reader.onload =
                        () =>
                            resolve(
                                reader.result
                            );

                    reader.onerror =
                        () =>
                            resolve(
                                null
                            );

                    reader.readAsDataURL(
                        blob
                    );
                }
            );
        } catch (error) {
            warn(
                'Falha ao converter imagem:',
                error
            );

            return null;
        }
    }

    // ============================================================
    // PROMPT
    // ============================================================

    function buildPrompt(
        data
    ) {
        const options =
            data.options
                ?.map(
                    (option, index) =>
                        `${String.fromCharCode(
                            65 + index
                        )}. ${option.text}`
                )
                .join('\n') ||
            '';

        const draggable =
            data.draggableOptions
                ?.map(
                    (option, index) =>
                        `${index + 1}. ${option.text}`
                )
                .join('\n') ||
            '';

        const draggableItems =
            data.draggableItems
                ?.map(
                    (item, index) =>
                        `${index + 1}. ${
                            item.text ||
                            item.id ||
                            item.imageUrl ||
                            ''
                        }`
                )
                .join('\n') ||
            '';

        const dropZones =
            data.dropZones
                ?.map(
                    (zone, index) =>
                        `${index + 1}. ${
                            zone.text ||
                            zone.prompt ||
                            ''
                        }`
                )
                .join('\n') ||
            '';

        let prompt = `
Você é um assistente extremamente preciso para responder questões de quiz.

Analise a questão abaixo e determine a resposta correta.

TIPO DA QUESTÃO:
${data.questionType}

QUESTÃO:
${data.questionText}
`;

        if (options) {
            prompt += `
OPÇÕES:
${options}
`;
        }

        if (data.allAvailableOptions?.length) {
            prompt += `
OPÇÕES DISPONÍVEIS:
${data.allAvailableOptions
    .map(
        (x, i) =>
            `${i + 1}. ${x}`
    )
    .join('\n')}
`;
        }

        if (draggable) {
            prompt += `
ITENS PARA ARRASTAR:
${draggable}
`;
        }

        if (draggableItems) {
            prompt += `
ITENS:
${draggableItems}
`;
        }

        if (dropZones) {
            prompt += `
DESTINOS:
${dropZones}
`;
        }

        prompt += `
REGRAS:
- Responda somente com a resposta final.
- Não explique.
- Se houver alternativas, indique a letra e o texto.
- Em questões de associação, indique claramente cada correspondência.
- Em questões de ordenar, indique a sequência correta.
- Em questões abertas, escreva apenas a resposta que deve ser inserida.
- Se houver imagem, use também as informações visuais.
- Não invente informações.
`;

        return prompt.trim();
    }

    function parseAiResponse(
        text
    ) {
        const clean =
            normalizeText(
                text
            );

        if (!clean) {
            return null;
        }

        return clean
            .replace(
                /^```[\w-]*\s*/i,
                ''
            )
            .replace(
                /\s*```$/i,
                ''
            )
            .trim();
    }

    // ============================================================
    // GEMINI
    // ============================================================

    function getGeminiKeys() {
        return GEMINI_API_KEYS.filter(
            isConfiguredKey
        );
    }

    function getOpenRouterKeys() {
        return OPENROUTER_API_KEYS.filter(
            isConfiguredKey
        );
    }

    function getCurrentGeminiKey() {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            return null;
        }

        return keys[
            currentGeminiKeyIndex %
                keys.length
        ];
    }

    function rotateGeminiKey() {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            return;
        }

        currentGeminiKeyIndex =
            (
                currentGeminiKeyIndex +
                1
            ) %
            keys.length;
    }

    function getCurrentOpenRouterKey() {
        const keys =
            getOpenRouterKeys();

        if (!keys.length) {
            return null;
        }

        return keys[
            currentOpenRouterKeyIndex %
                keys.length
        ];
    }

    function rotateOpenRouterKey() {
        const keys =
            getOpenRouterKeys();

        if (!keys.length) {
            return;
        }

        currentOpenRouterKeyIndex =
            (
                currentOpenRouterKeyIndex +
                1
            ) %
            keys.length;
    }

    async function askGemini(
        prompt,
        imageDataUrl = null
    ) {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            throw new Error(
                'Nenhuma chave Gemini configurada.'
            );
        }

        let lastError =
            null;

        for (
            let attempt = 0;
            attempt <
                keys.length;
            attempt++
        ) {
            const key =
                getCurrentGeminiKey();

            if (!key) {
                break;
            }

            const parts = [
                {
                    text:
                        prompt
                }
            ];

            if (
                imageDataUrl
            ) {
                const match =
                    imageDataUrl.match(
                        /^data:([^;]+);base64,(.+)$/s
                    );

                if (match) {
                    parts.push({
                        inline_data: {
                            mime_type:
                                match[1],
                            data:
                                match[2]
                        }
                    });
                }
            }

            try {
                const response =
                    await fetchWithTimeout(
                        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
                            CONFIG.geminiModel
                        )}:generateContent?key=${encodeURIComponent(
                            key
                        )}`,
                        {
                            method:
                                'POST',
                            headers: {
                                'Content-Type':
                                    'application/json'
                            },
                            body:
                                JSON.stringify({
                                    contents: [
                                        {
                                            parts
                                        }
                                    ],
                                    generationConfig: {
                                        temperature:
                                            0,
                                        maxOutputTokens:
                                            300
                                    }
                                })
                        },
                        CONFIG.requestTimeout
                    );

                if (
                    response.ok
                ) {
                    const json =
                        await response.json();

                    const text =
                        json?.candidates?.[0]
                            ?.content?.parts
                            ?.map(
                                part =>
                                    part.text ||
                                    ''
                            )
                            .join(' ') ||
                        '';

                    const answer =
                        parseAiResponse(
                            text
                        );

                    if (answer) {
                        return answer;
                    }

                    throw new Error(
                        'Gemini retornou resposta vazia.'
                    );
                }

                const body =
                    await safeResponseText(
                        response
                    );

                const error =
                    new Error(
                        `Gemini HTTP ${response.status}: ${body}`
                    );

                error.status =
                    response.status;

                throw error;
            } catch (error) {
                lastError =
                    error;

                warn(
                    'Erro Gemini:',
                    error
                );

                if (
                    isRotatableStatus(
                        error?.status
                    )
                ) {
                    rotateGeminiKey();
                    continue;
                }

                throw error;
            }
        }

        throw (
            lastError ||
            new Error(
                'Falha ao consultar Gemini.'
            )
        );
    }
        }

        if (data.allAvailableOptions) {
            parts.push(
                data.allAvailableOptions
                    .map(normalizeForMatch)
                    .join('|')
            );
        }

        if (data.draggableOptions) {
            parts.push(
                data.draggableOptions
                    .map(x => normalizeForMatch(x.text))
                    .join('|')
            );
        }

        if (data.draggableItems) {
            parts.push(
                data.draggableItems
                    .map(x =>
                        normalizeForMatch(
                            x.text ||
                            x.id ||
                            x.imageUrl ||
                            ''
                        )
                    )
                    .join('|')
            );
        }

        if (data.dropZones) {
            parts.push(
                data.dropZones
                    .map(x =>
                        normalizeForMatch(
                            x.text ||
                            x.prompt ||
                            ''
                        )
                    )
                    .join('|')
            );
        }

        return parts.join('||');
    }

    function normalizeForMatch(text) {
        return normalizeText(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(
                /[\u0300-\u036f]/g,
                ''
            )
            .replace(
                /[^\p{L}\p{N}\s]/gu,
                ' '
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim();
    }

    // ============================================================
    // CACHE PERSISTENTE
    // ============================================================

    const STORAGE_CACHE_KEY =
        'nikolas_quizizz_v52_cache';

    function loadPersistentCache() {
        try {
            const raw =
                localStorage.getItem(
                    STORAGE_CACHE_KEY
                );

            if (!raw) return;

            const parsed =
                JSON.parse(raw);

            if (
                !parsed ||
                typeof parsed !==
                    'object'
            ) {
                return;
            }

            for (
                const [key, value] of
                Object.entries(parsed)
            ) {
                if (
                    !value ||
                    typeof value !==
                        'object'
                ) {
                    continue;
                }

                if (
                    Date.now() -
                        Number(
                            value.timestamp ||
                                0
                        ) >
                    CONFIG.cacheTtl
                ) {
                    continue;
                }

                answerCache.set(
                    key,
                    value
                );
            }

            log(
                'Cache persistente carregado:',
                answerCache.size
            );
        } catch (error) {
            warn(
                'Erro ao carregar cache:',
                error
            );
        }
    }

    function savePersistentCache() {
        try {
            const object = {};

            for (
                const [key, value] of
                answerCache.entries()
            ) {
                object[key] = value;
            }

            localStorage.setItem(
                STORAGE_CACHE_KEY,
                JSON.stringify(object)
            );
        } catch (error) {
            warn(
                'Erro ao salvar cache:',
                error
            );
        }
    }

    function getAnswerFromCache(
        fingerprint
    ) {
        if (!fingerprint) {
            return null;
        }

        const memory =
            answerCache.get(
                fingerprint
            );

        if (memory) {
            if (
                Date.now() -
                    memory.timestamp <=
                CONFIG.cacheTtl
            ) {
                return memory.answer;
            }

            answerCache.delete(
                fingerprint
            );
        }

        try {
            const raw =
                localStorage.getItem(
                    STORAGE_CACHE_KEY
                );

            if (!raw) {
                return null;
            }

            const parsed =
                JSON.parse(raw);

            const entry =
                parsed?.[
                    fingerprint
                ];

            if (!entry) {
                return null;
            }

            if (
                Date.now() -
                    Number(
                        entry.timestamp ||
                            0
                    ) >
                CONFIG.cacheTtl
            ) {
                delete parsed[
                    fingerprint
                ];

                localStorage.setItem(
                    STORAGE_CACHE_KEY,
                    JSON.stringify(
                        parsed
                    )
                );

                return null;
            }

            answerCache.set(
                fingerprint,
                entry
            );

            return entry.answer;
        } catch (error) {
            warn(
                'Erro ao consultar cache persistente:',
                error
            );

            return null;
        }
    }

    function saveAnswerToCache(
        fingerprint,
        answer
    ) {
        if (
            !fingerprint ||
            !answer
        ) {
            return;
        }

        const entry = {
            answer,
            timestamp:
                Date.now()
        };

        answerCache.set(
            fingerprint,
            entry
        );

        if (
            answerCache.size >
            150
        ) {
            const first =
                answerCache.keys()
                    .next()
                    .value;

            answerCache.delete(
                first
            );
        }

        savePersistentCache();
    }

    // ============================================================
    // IMAGENS
    // ============================================================

    function imageUrlFromElement(
        element
    ) {
        if (!element) {
            return null;
        }

        if (
            element.tagName ===
            'IMG'
        ) {
            return (
                element.currentSrc ||
                element.src ||
                element.getAttribute(
                    'data-src'
                ) ||
                null
            );
        }

        const image =
            element.querySelector(
                'img'
            );

        if (image) {
            return (
                image.currentSrc ||
                image.src ||
                image.getAttribute(
                    'data-src'
                ) ||
                null
            );
        }

        const style =
            element.getAttribute(
                'style'
            ) || '';

        const match =
            style.match(
                /url\(["']?([^"')]+)["']?\)/i
            );

        return match?.[1] ||
            null;
    }

    function findQuestionImage(
        container
    ) {
        const roots =
            uniqueElements([
                container,
                document
            ]);

        const candidates = [];

        for (
            const root of
            roots
        ) {
            root.querySelectorAll?.(
                'img, [style*="background-image" i]'
            ).forEach(
                element => {
                    if (
                        !isVisible(
                            element
                        )
                    ) {
                        return;
                    }

                    const url =
                        imageUrlFromElement(
                            element
                        );

                    if (!url) {
                        return;
                    }

                    candidates.push({
                        element,
                        url
                    });
                }
            );
        }

        if (!candidates.length) {
            return null;
        }

        const scored =
            candidates.map(
                item => {
                    const rect =
                        item.element.getBoundingClientRect();

                    let score =
                        rect.width *
                        rect.height;

                    const alt =
                        item.element.getAttribute(
                            'alt'
                        ) || '';

                    if (
                        /question|questao|questão|image|imagem/i.test(
                            alt
                        )
                    ) {
                        score +=
                            100000;
                    }

                    return {
                        ...item,
                        score
                    };
                }
            );

        scored.sort(
            (a, b) =>
                b.score -
                a.score
        );

        return scored[0] ||
            null;
    }

    async function imageToDataUrl(
        url
    ) {
        if (!url) {
            return null;
        }

        try {
            const response =
                await fetch(
                    url,
                    {
                        credentials:
                            'include'
                    }
                );

            if (!response.ok) {
                return null;
            }

            const blob =
                await response.blob();

            if (
                blob.size >
                CONFIG.maxImageBytes
            ) {
                warn(
                    'Imagem ignorada por tamanho:',
                    blob.size
                );

                return null;
            }

            return await new Promise(
                resolve => {
                    const reader =
                        new FileReader();

                    reader.onload =
                        () =>
                            resolve(
                                reader.result
                            );

                    reader.onerror =
                        () =>
                            resolve(
                                null
                            );

                    reader.readAsDataURL(
                        blob
                    );
                }
            );
        } catch (error) {
            warn(
                'Falha ao converter imagem:',
                error
            );

            return null;
        }
    }

    // ============================================================
    // PROMPT
    // ============================================================

    function buildPrompt(
        data
    ) {
        const options =
            data.options
                ?.map(
                    (option, index) =>
                        `${String.fromCharCode(
                            65 + index
                        )}. ${option.text}`
                )
                .join('\n') ||
            '';

        const draggable =
            data.draggableOptions
                ?.map(
                    (option, index) =>
                        `${index + 1}. ${option.text}`
                )
                .join('\n') ||
            '';

        const draggableItems =
            data.draggableItems
                ?.map(
                    (item, index) =>
                        `${index + 1}. ${
                            item.text ||
                            item.id ||
                            item.imageUrl ||
                            ''
                        }`
                )
                .join('\n') ||
            '';

        const dropZones =
            data.dropZones
                ?.map(
                    (zone, index) =>
                        `${index + 1}. ${
                            zone.text ||
                            zone.prompt ||
                            ''
                        }`
                )
                .join('\n') ||
            '';

        let prompt = `
Você é um assistente extremamente preciso para responder questões de quiz.

Analise a questão abaixo e determine a resposta correta.

TIPO DA QUESTÃO:
${data.questionType}

QUESTÃO:
${data.questionText}
`;

        if (options) {
            prompt += `
OPÇÕES:
${options}
`;
        }

        if (data.allAvailableOptions?.length) {
            prompt += `
OPÇÕES DISPONÍVEIS:
${data.allAvailableOptions
    .map(
        (x, i) =>
            `${i + 1}. ${x}`
    )
    .join('\n')}
`;
        }

        if (draggable) {
            prompt += `
ITENS PARA ARRASTAR:
${draggable}
`;
        }

        if (draggableItems) {
            prompt += `
ITENS:
${draggableItems}
`;
        }

        if (dropZones) {
            prompt += `
DESTINOS:
${dropZones}
`;
        }

        prompt += `
REGRAS:
- Responda somente com a resposta final.
- Não explique.
- Se houver alternativas, indique a letra e o texto.
- Em questões de associação, indique claramente cada correspondência.
- Em questões de ordenar, indique a sequência correta.
- Em questões abertas, escreva apenas a resposta que deve ser inserida.
- Se houver imagem, use também as informações visuais.
- Não invente informações.
`;

        return prompt.trim();
    }

    function parseAiResponse(
        text
    ) {
        const clean =
            normalizeText(
                text
            );

        if (!clean) {
            return null;
        }

        return clean
            .replace(
                /^```[\w-]*\s*/i,
                ''
            )
            .replace(
                /\s*```$/i,
                ''
            )
            .trim();
    }

    // ============================================================
    // GEMINI
    // ============================================================

    function getGeminiKeys() {
        return GEMINI_API_KEYS.filter(
            isConfiguredKey
        );
    }

    function getOpenRouterKeys() {
        return OPENROUTER_API_KEYS.filter(
            isConfiguredKey
        );
    }

    function getCurrentGeminiKey() {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            return null;
        }

        return keys[
            currentGeminiKeyIndex %
                keys.length
        ];
    }

    function rotateGeminiKey() {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            return;
        }

        currentGeminiKeyIndex =
            (
                currentGeminiKeyIndex +
                1
            ) %
            keys.length;
    }

    function getCurrentOpenRouterKey() {
        const keys =
            getOpenRouterKeys();

        if (!keys.length) {
            return null;
        }

        return keys[
            currentOpenRouterKeyIndex %
                keys.length
        ];
    }

    function rotateOpenRouterKey() {
        const keys =
            getOpenRouterKeys();

        if (!keys.length) {
            return;
        }

        currentOpenRouterKeyIndex =
            (
                currentOpenRouterKeyIndex +
                1
            ) %
            keys.length;
    }

    async function askGemini(
        prompt,
        imageDataUrl = null
    ) {
        const keys =
            getGeminiKeys();

        if (!keys.length) {
            throw new Error(
                'Nenhuma chave Gemini configurada.'
            );
        }

        let lastError =
            null;

        for (
            let attempt = 0;
            attempt <
                keys.length;
            attempt++
        ) {
            const key =
                getCurrentGeminiKey();

            if (!key) {
                break;
            }

            const parts = [
                {
                    text:
                        prompt
                }
            ];

            if (
                imageDataUrl
            ) {
                const match =
                    imageDataUrl.match(
                        /^data:([^;]+);base64,(.+)$/s
                    );

                if (match) {
                    parts.push({
                        inline_data: {
                            mime_type:
                                match[1],
                            data:
                                match[2]
                        }
                    });
                }
            }

            try {
                const response =
                    await fetchWithTimeout(
                        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
                            CONFIG.geminiModel
                        )}:generateContent?key=${encodeURIComponent(
                            key
                        )}`,
                        {
                            method:
                                'POST',
                            headers: {
                                'Content-Type':
                                    'application/json'
                            },
                            body:
                                JSON.stringify({
                                    contents: [
                                        {
                                            parts
                                        }
                                    ],
                                    generationConfig: {
                                        temperature:
                                            0,
                                        maxOutputTokens:
                                            300
                                    }
                                })
                        },
                        CONFIG.requestTimeout
                    );

                if (
                    response.ok
                ) {
                    const json =
                        await response.json();

                    const text =
                        json?.candidates?.[0]
                            ?.content?.parts
                            ?.map(
                                part =>
                                    part.text ||
                                    ''
                            )
                            .join(' ') ||
                        '';

                    const answer =
                        parseAiResponse(
                            text
                        );

                    if (answer) {
                        return answer;
                    }

                    throw new Error(
                        'Gemini retornou resposta vazia.'
                    );
                }

                const body =
                    await safeResponseText(
                        response
                    );

                const error =
                    new Error(
                        `Gemini HTTP ${response.status}: ${body}`
                    );

                error.status =
                    response.status;

                throw error;
            } catch (error) {
                lastError =
                    error;

                warn(
                    'Erro Gemini:',
                    error
                );

                if (
                    isRotatableStatus(
                        error?.status
                    )
                ) {
                    rotateGeminiKey();
                    continue;
                }

                throw error;
            }
        }

        throw (
            lastError ||
            new Error(
                'Falha ao consultar Gemini.'
            )
        );
    }
                    `OpenRouter chave ${index + 1} falhou:`,
                    message
                );
            } catch (error) {
                lastError = error;
                log(
                    `OpenRouter chave ${index + 1}:`,
                    error.message
                );
            }
        }

        throw (
            lastError ||
            new Error(
                'Nenhuma chave OpenRouter utilizável.'
            )
        );
    }

    // ============================================================
    // CONSULTA À IA
    // ============================================================

    async function getAiAnswer(data) {
        const fingerprint =
            buildFingerprint(data);

        const cached =
            cacheGet(fingerprint);

        if (cached) {
            log('Resposta encontrada no cache.');
            return cached;
        }

        const prompt =
            buildPrompt(data);

        let imageDataUrl = null;

        // Só envia imagem para Gemini.
        if (
            CONFIG.provider === 'gemini' &&
            data.questionImageUrl
        ) {
            imageDataUrl =
                await imageUrlToBase64(
                    data.questionImageUrl
                );
        }

        let answer;

        if (
            CONFIG.provider === 'gemini'
        ) {
            answer =
                await requestGemini(
                    prompt,
                    imageDataUrl
                );
        } else if (
            CONFIG.provider === 'openrouter'
        ) {
            answer =
                await requestOpenRouter(
                    prompt
                );
        } else {
            throw new Error(
                `Provider inválido: ${CONFIG.provider}`
            );
        }

        answer =
            cleanAiAnswer(answer);

        if (!answer) {
            throw new Error(
                'A IA retornou uma resposta vazia.'
            );
        }

        cacheSet(
            fingerprint,
            answer
        );

        return answer;
    }

    function cleanAiAnswer(answer) {
        return String(answer || '')
            .replace(/^```(?:text|plaintext)?/i, '')
            .replace(/```$/i, '')
            .replace(/^Resposta:\s*/i, '')
            .trim();
    }

    // ============================================================
    // INTERFACE
    // ============================================================

    function removeElement(id) {
        document.getElementById(id)?.remove();
    }

    function showStatus(text, error = false) {
        removeElement('nikolas-status');

        const el =
            document.createElement('div');

        el.id = 'nikolas-status';

        Object.assign(
            el.style,
            {
                position: 'fixed',
                top: '18px',
                left: '50%',
                transform:
                    'translateX(-50%)',
                zIndex: '2147483647',
                padding: '9px 15px',
                borderRadius: '999px',
                background:
                    'rgba(10,14,18,.94)',
                border:
                    `1px solid ${error ? '#ff3b6b' : '#00ffff'}`,
                color: '#fff',
                font:
                    '600 12px/1.2 system-ui,sans-serif',
                boxShadow:
                    '0 0 20px rgba(0,255,255,.12)',
                pointerEvents: 'none'
            }
        );

        el.textContent = text;

        document.body.appendChild(el);

        setTimeout(
            () => el.remove(),
            2200
        );
    }

    function showResult(answer, data, fromCache = false) {
        removeElement('nikolas-result-toast');

        const box =
            document.createElement('div');

        box.id =
            'nikolas-result-toast';

        Object.assign(
            box.style,
            {
                position: 'fixed',
                right: '20px',
                bottom: '20px',
                zIndex: '2147483647',
                width:
                    'min(560px, calc(100vw - 40px))',
                maxHeight: '50vh',
                overflow: 'auto',
                padding: '16px 18px',
                borderRadius: '16px',
                color: '#fff',
                background:
                    'rgba(9,13,18,.96)',
                border:
                    '1px solid rgba(0,255,255,.48)',
                boxShadow:
                    '0 0 30px rgba(0,255,255,.16)',
                font:
                    '14px/1.5 system-ui,sans-serif',
                whiteSpace: 'pre-wrap',
                backdropFilter:
                    'blur(12px)'
            }
        );

        const header =
            document.createElement('div');

        Object.assign(
            header.style,
            {
                display: 'flex',
                justifyContent:
                    'space-between',
                gap: '12px',
                alignItems: 'center',
                marginBottom: '10px'
            }
        );

        const title =
            document.createElement('strong');

        title.textContent =
            'Nikolas Scripts — Resposta da IA';

        title.style.color =
            '#66ffff';

        const badge =
            document.createElement('span');

        badge.textContent =
            fromCache ? 'CACHE' : 'IA';

        Object.assign(
            badge.style,
            {
                fontSize: '10px',
                fontWeight: '800',
                padding: '3px 7px',
                borderRadius: '999px',
                border:
                    '1px solid rgba(0,255,255,.4)'
            }
        );

        header.append(
            title,
            badge
        );

        const type =
            document.createElement('div');

        type.textContent =
            `Tipo: ${data.questionType}`;

        type.style.opacity = '.65';
        type.style.fontSize = '11px';
        type.style.marginBottom = '8px';

        const body =
            document.createElement('div');

        body.textContent = answer;

        box.append(
            header,
            type,
            body
        );

        document.body.appendChild(box);

        setTimeout(
            () => box.remove(),
            15000
        );
    }

    function setCursorState(state) {
        const old =
            document.getElementById(
                'nikolas-cursor-style'
            );

        old?.remove();

        document.documentElement.dataset
            .nikolasCursor = state;

        if (state === 'normal') return;

        const svg =
            state === 'processing'
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="10" fill="none" stroke="#00ffff" stroke-width="3" stroke-dasharray="16 8"/></svg>`
                : state === 'success'
                    ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#00ffff"/><path d="m9 16 4 4 10-10" fill="none" stroke="#001010" stroke-width="3"/></svg>`
                    : `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#ff3b6b"/><path d="m10 10 12 12M22 10 10 22" stroke="#fff" stroke-width="3"/></svg>`;

        const style =
            document.createElement('style');

        style.id =
            'nikolas-cursor-style';

        style.textContent =
            `html[data-nikolas-cursor="${state}"] *,html[data-nikolas-cursor="${state}"]{cursor:url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16,auto !important}`;

        document.head.appendChild(style);
    }

    // ============================================================
    // RESOLVER
    // ============================================================

    async function resolverQuestao() {
        if (
            busy &&
            CONFIG.preventDuplicateRequests
        ) {
            return;
        }

        busy = true;
        setCursorState('processing');
        showStatus('Analisando questão...');

        try {
            const data =
                await extractQuestion();

            const fingerprint =
                buildFingerprint(data);

            if (
                fingerprint === lastFingerprint &&
                lastAnswer
            ) {
                showResult(
                    lastAnswer,
                    data,
                    true
                );

                setCursorState('success');
                showStatus(
                    'Resposta já analisada.'
                );

                return;
            }

            lastFingerprint =
                fingerprint;

            showStatus(
                'Consultando a IA...'
            );

            const cached =
                cacheGet(fingerprint);

            const answer =
                cached ||
                await getAiAnswer(data);

            lastAnswer = answer;

            showResult(
                answer,
                data,
                !!cached
            );

            setCursorState('success');
            showStatus(
                cached
                    ? 'Resposta recuperada do cache.'
                    : 'Resposta recebida.'
            );
        } catch (error) {
            console.error(
                '[Nikolas v52] Falha:',
                error
            );

            setCursorState('error');

            showStatus(
                error?.message ||
                'Falha ao analisar a questão.',
                true
            );
        } finally {
            await sleep(600);

            setCursorState('normal');
            busy = false;
        }
    }

    // ============================================================
    // ATALHO
    // ============================================================

    document.addEventListener(
        'keydown',
        event => {
            if (
                event.code !== 'Space' ||
                event.repeat
            ) {
                return;
            }

            const target =
                event.target;

            if (
                target?.matches?.(
                    'input,textarea,select,[contenteditable="true"]'
                ) ||
                target?.closest?.(
                    'input,textarea,select,[contenteditable="true"]'
                )
            ) {
                return;
            }

            event.preventDefault();
            resolverQuestao();
        },
        true
    );

    // ============================================================
    // OBSERVADOR DE TROCA DE QUESTÃO
    // ============================================================

    function startObserver() {
        if (observer) return;

        observer =
            new MutationObserver(() => {
                // Apenas limpa a resposta anterior quando
                // o texto principal realmente mudou.
                const container =
                    findQuestionContainer();

                const currentText =
                    getQuestionText(container);

                if (
                    currentText &&
                    !normalizeForMatch(
                        currentText
                    ).includes(
                        normalizeForMatch(
                            lastAnswer
                        )
                    )
                ) {
                    // Não fazemos requisição automática.
                    // Apenas permitimos que a próxima
                    // análise seja feita normalmente.
                }
            });

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true,
                characterData: true
            }
        );
    }

    // ============================================================
    // DETECTOR DE QUIZ ID
    // ============================================================

    const regexQuizId =
        /\/(?:quiz|quizzes|admin\/quiz|games|attempts|join)\/([a-f0-9]{24})/i;

    let detectedQuizId = null;

    function logQuizId(id, source) {
        if (
            !id ||
            id === detectedQuizId
        ) {
            return;
        }

        detectedQuizId = id;

        log(
            `Quiz ID detectado (${source}):`,
            id
        );
    }

    function detectQuizIdFromUrl() {
        return (
            location.pathname.match(
                regexQuizId
            )?.[1] || null
        );
    }

    function initQuizIdDetector() {
        const id =
            detectQuizIdFromUrl();

        if (id) {
            logQuizId(id, 'URL');
        }
    }

    function monitorSpaNavigation() {
        const originalPush =
            history.pushState;

        history.pushState =
            function (...args) {
                const result =
                    originalPush.apply(
                        this,
                        args
                    );

                setTimeout(
                    initQuizIdDetector,
                    150
                );

                return result;
            };

        addEventListener(
            'popstate',
            () =>
                setTimeout(
                    initQuizIdDetector,
                    150
                )
        );
    }

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================

    function init() {
        if (initialized) return;

        initialized = true;

        setCursorState('normal');

        initQuizIdDetector();
        monitorSpaNavigation();
        startObserver();

        console.log(
            '%c[Nikolas v52] Carregado.',
            'color:#00ffff;font-weight:700'
        );

        console.log(
            '[Nikolas v52] Pressione ESPAÇO para analisar a questão.'
        );

        if (
            CONFIG.provider === 'gemini' &&
            !GEMINI_API_KEYS.some(isConfiguredKey)
        ) {
            warn(
                'Nenhuma chave Gemini configurada.'
            );
        }

        if (
            CONFIG.provider === 'openrouter' &&
            !OPENROUTER_API_KEYS.some(isConfiguredKey)
        ) {
            warn(
                'Nenhuma chave OpenRouter configurada.'
            );
        }
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            { once: true }
        );
    } else {
        init();
    }
})();
