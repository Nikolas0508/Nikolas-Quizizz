// ==UserScript==
// @name         Nikolas Quizizz
// @version      51.1
// @description  Assistente de questões: extrai texto/imagens, consulta a IA e mostra a resposta sem clicar/enviar automaticamente.
// @author       Nikolas
// @match        https://wayground.com/join/game/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // CHAVES — mantenha as suas aqui ou injete-as pelo bookmarklet.
    // ============================================================
    const GEMINI_API_KEYS = [
        "CHAVE_GEMINI_1",
        "CHAVE_GEMINI_2",
        "CHAVE_GEMINI_3"
    ];

    const OPENROUTER_API_KEYS = [
        "SUA_CHAVE_OPENROUTER_1",
        "SUA_CHAVE_OPENROUTER_2",
        "SUA_CHAVE_OPENROUTER_3"
    ];

    const DEEPSEEK_MODEL_NAME = "deepseek/deepseek-chat";
    let currentAiProvider = 'gemini';
    let currentApiKeyIndex = 0;
    let currentOpenRouterKeyIndex = 0;
    let lastAiResponse = '';
    let busy = false;
    let lastQuestionFingerprint = '';

    const regexQuizId = /\/(?:quiz|quizzes|admin\/quiz|games|attempts|join)\/([a-f0-9]{24})/i;
    let quizIdDetected = null;
    let interceptorsStarted = false;

    // ============================================================
    // UTILITÁRIOS
    // ============================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function normalizeText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeForMatch(value) {
        return normalizeText(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/["'`]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' &&
            parseFloat(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;
    }

    function uniqueStrings(items) {
        const seen = new Set();
        return items.map(normalizeText).filter(v => {
            const k = normalizeForMatch(v);
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    function textFromElement(el) {
        if (!el) return '';
        const selectors = [
            '#optionText', '.option-text', '[data-testid="option-text"]',
            '.dnd-option-text', '[data-cy="option-text"]', '.match-order-option-text',
            '[aria-label]', '[title]'
        ];
        for (const selector of selectors) {
            const node = el.matches?.(selector) ? el : el.querySelector?.(selector);
            if (node) {
                const attr = node.getAttribute?.('aria-label') || node.getAttribute?.('title');
                const value = normalizeText(attr || node.innerText || node.textContent);
                if (value) return value;
            }
        }
        const annotation = el.querySelector?.('annotation[encoding="application/x-tex"]');
        if (annotation?.textContent) return normalizeText(annotation.textContent);
        return normalizeText(el.innerText || el.textContent);
    }

    function imageUrlFromElement(el) {
        if (!el) return null;

        if (el.tagName === 'IMG') {
            const candidates = [
                el.currentSrc,
                el.src,
                el.getAttribute('src')
            ];

            const srcset = el.getAttribute('srcset');
            if (srcset) {
                candidates.push(
                    srcset.split(',')[0]?.trim().split(/\s+/)[0]
                );
            }

            return candidates.find(v =>
                /^https?:\/\//i.test(v || '') ||
                /^data:image\//i.test(v || '')
            ) || null;
        }

        const style = getComputedStyle(el);
        const bg = style.backgroundImage || el.style?.backgroundImage || '';
        const match = bg.match(/url\(\s*["']?(.*?)["']?\s*\)/i);

        if (match?.[1]) {
            try {
                return new URL(match[1], location.href).href;
            } catch (_) {
                return match[1];
            }
        }

        for (const attr of ['data-src', 'data-image-url', 'data-url']) {
            const v = el.getAttribute?.(attr);
            if (
                v &&
                (
                    /^https?:\/\//i.test(v) ||
                    /^data:image\//i.test(v)
                )
            ) {
                return v;
            }
        }

        const dataCy = el.getAttribute?.('data-cy') || '';
        const dataMatch = dataCy.match(/url\((.*?)\)/i);

        if (dataMatch?.[1]) {
            return dataMatch[1].replace(/^['"]|['"]$/g, '');
        }

        return null;
    }

    function looksLikeDecorativeImage(img) {
        if (!img || !isVisible(img)) return true;

        const src = (img.currentSrc || img.src || '').toLowerCase();
        const alt = (img.alt || '').toLowerCase();
        const cls = (img.className || '').toString().toLowerCase();

        if (/avatar|logo|icon|profile|flag|emoji|brand/.test(
            `${alt} ${cls} ${src}`
        )) {
            return true;
        }

        const r = img.getBoundingClientRect();

        if (r.width < 35 || r.height < 35) return true;

        return false;
    }

    function findQuestionContainer() {
        const q = document.querySelector(
            '#questionText, [data-testid="question-text"], [data-cy="question-text"]'
        );

        if (!q) {
            return document.querySelector(
                '[data-testid="question-container"], .question-container'
            ) || document.body;
        }

        let best = null;
        let node = q;

        for (
            let depth = 0;
            node && depth < 7;
            depth++,
            node = node.parentElement
        ) {
            const rect = node.getBoundingClientRect();

            const optionCount =
                node.querySelectorAll?.(
                    '.option.is-selectable, button.options-dropdown, .drag-option, .match-order-option'
                )?.length || 0;

            const imageCount =
                node.querySelectorAll?.('img')?.length || 0;

            let score = 0;

            if (
                node.matches?.(
                    '[data-testid="question-container"], .question-container'
                )
            ) {
                score += 100;
            }

            if (optionCount > 0) score += 30;
            if (imageCount > 0) score += 10;

            if (rect.width > 200 && rect.height > 100) {
                score += 5;
            }

            score -= depth;

            if (!best || score > best.score) {
                best = {
                    node,
                    score
                };
            }
        }

        return best?.node || q.parentElement || document.body;
    }

    function findQuestionImage(container) {
        const qText = document.querySelector(
            '#questionText, [data-testid="question-text"], [data-cy="question-text"]'
        );

        const qRect = qText?.getBoundingClientRect();
        const candidates = [];

        const roots = [
            container,
            qText?.parentElement,
            document.body
        ];

        const seen = new Set();

        for (const root of roots) {
            if (!root) continue;

            root.querySelectorAll?.('img').forEach(img => {
                if (
                    seen.has(img) ||
                    looksLikeDecorativeImage(img)
                ) {
                    return;
                }

                seen.add(img);

                const r = img.getBoundingClientRect();
                let score = 0;

                if (container.contains(img)) {
                    score += 50;
                }

                if (
                    img.matches(
                        '[data-testid="question-container-image"], [data-testid*="question" i]'
                    )
                ) {
                    score += 80;
                }

                if (
                    /question|prompt|stem/i.test(
                        `${img.className} ${img.alt} ${img.getAttribute('data-testid') || ''}`
                    )
                ) {
                    score += 30;
                }

                if (qRect) {
                    const dy = Math.abs(r.top - qRect.bottom);

                    const dx = Math.abs(
                        (r.left + r.right) / 2 -
                        (qRect.left + qRect.right) / 2
                    );

                    score += Math.max(0, 25 - dy / 30);
                    score += Math.max(0, 10 - dx / 50);
                }

                score += Math.min(
                    20,
                    (r.width * r.height) / 20000
                );

                candidates.push({
                    img,
                    score
                });
            });
        }
                const bgCandidates =
            container?.querySelectorAll?.(
                '[style*="background-image"], .option-image'
            ) || [];

        bgCandidates.forEach(el => {
            if (!isVisible(el)) return;

            const url = imageUrlFromElement(el);

            if (!url) return;

            const r = el.getBoundingClientRect();

            candidates.push({
                el,
                url,
                score: 20 + Math.min(
                    15,
                    (r.width * r.height) / 20000
                )
            });
        });

        candidates.sort((a, b) => b.score - a.score);

        const best = candidates[0];

        return best
            ? {
                element: best.img || best.el,
                url: best.url ||
                    imageUrlFromElement(
                        best.img || best.el
                    ),
                score: best.score
            }
            : null;
    }

    async function waitForStableQuestion(timeout = 1200) {
        const start = Date.now();
        let previous = '';
        let stable = 0;

        while (Date.now() - start < timeout) {
            const q = document.querySelector(
                '#questionText, [data-testid="question-text"], [data-cy="question-text"]'
            );

            const value = normalizeText(
                q?.innerText || q?.textContent
            );

            if (value && value === previous) {
                stable += 1;
            } else {
                stable = 0;
            }

            previous = value;

            if (stable >= 2) return;

            await sleep(120);
        }
    }

    function extractQuestionText(container) {
        const nodes = [
            document.querySelector('#questionText'),
            document.querySelector('[data-testid="question-text"]'),
            document.querySelector('[data-cy="question-text"]'),
            container?.querySelector?.(
                '[class*="question-text" i]'
            )
        ].filter(Boolean);

        for (const node of nodes) {
            const value = normalizeText(
                node.innerText || node.textContent
            );

            if (value) return value;
        }

        return normalizeText(
            container?.innerText || ''
        )
            .split(/\n+/)
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, 3)
            .join(' ');
    }

    function extractOptions(container) {
        const roots = [
            container,
            document
        ].filter(Boolean);

        const selectors = [
            '.option.is-selectable',
            '[data-testid="option"]',
            '[data-cy="option"]',
            '.answer-option',
            '.question-option'
        ];

        const found = [];
        const seen = new Set();

        for (const root of roots) {
            for (const selector of selectors) {
                root.querySelectorAll?.(selector).forEach(el => {
                    if (!isVisible(el) || seen.has(el)) {
                        return;
                    }

                    const text = textFromElement(el);

                    if (!text) return;

                    seen.add(el);

                    found.push({
                        text,
                        element: el
                    });
                });
            }

            if (found.length >= 2) break;
        }

        return found;
    }

    // ============================================================
    // EXTRAÇÃO DA QUESTÃO
    // ============================================================
    async function extrairDadosDaQuestao() {
        try {
            await waitForStableQuestion();

            const container = findQuestionContainer();

            const questionText =
                extractQuestionText(container);

            const imageInfo =
                findQuestionImage(container);

            const questionImageUrl =
                imageInfo?.url || null;

            const dropdownButtons =
                Array.from(
                    document.querySelectorAll(
                        'button.options-dropdown'
                    )
                ).filter(isVisible);

            if (dropdownButtons.length > 1) {
                let cleanQuestionText = questionText;

                const first = dropdownButtons[0];

                first.click();

                await sleep(100);

                let allAvailableOptions = [];

                const popper =
                    document.querySelector(
                        '.v-popper__popper--shown'
                    );

                if (popper) {
                    allAvailableOptions =
                        uniqueStrings(
                            Array.from(
                                popper.querySelectorAll(
                                    'button.dropdown-option'
                                )
                            ).map(textFromElement)
                        );

                    document.body.click();

                    await sleep(80);
                }

                return {
                    questionText: cleanQuestionText,
                    questionImageUrl,
                    questionType: 'multi_dropdown',
                    dropdowns: dropdownButtons.map(
                        button => ({
                            button
                        })
                    ),
                    allAvailableOptions
                };
            }

            if (dropdownButtons.length === 1) {
                const button = dropdownButtons[0];

                button.click();

                await sleep(100);

                const popper =
                    document.querySelector(
                        '.v-popper__popper--shown'
                    );

                const options = popper
                    ? Array.from(
                        popper.querySelectorAll(
                            'button.dropdown-option'
                        )
                    )
                        .filter(isVisible)
                        .map(el => ({
                            text: textFromElement(el),
                            element: el
                        }))
                    : [];

                if (popper) {
                    document.body.click();
                }

                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'dropdown',
                    dropdownButton: button,
                    options
                };
            }

            const equationEditor =
                document.querySelector(
                    'div[data-cy="equation-editor"]'
                );

            if (equationEditor) {
                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'equation'
                };
            }

            const droppableBlanks =
                Array.from(
                    document.querySelectorAll(
                        'button.droppable-blank'
                    )
                ).filter(isVisible);

            const dragOptions =
                Array.from(
                    document.querySelectorAll(
                        '.drag-option'
                    )
                ).filter(isVisible);

            if (
                droppableBlanks.length > 1 &&
                dragOptions.length > 0
            ) {
                const q =
                    document.querySelector(
                        '.drag-drop-text > div'
                    ) || container;

                const dropZones =
                    droppableBlanks.map(
                        (blank, i) => ({
                            prompt: normalizeText(
                                blank.parentElement?.innerText ||
                                `Lacuna ${i + 1}`
                            ),
                            blankElement: blank
                        })
                    );

                const draggableOptions =
                    dragOptions
                        .map(el => ({
                            text: textFromElement(el),
                            element: el
                        }))
                        .filter(x => x.text);

                return {
                    questionText:
                        normalizeText(q.innerText) ||
                        questionText,
                    questionImageUrl,
                    questionType:
                        'multi_drag_into_blank',
                    draggableOptions,
                    dropZones
                };
            }

            if (
                droppableBlanks.length === 1 &&
                dragOptions.length > 0
            ) {
                const draggableOptions =
                    dragOptions
                        .map(el => ({
                            text: textFromElement(el),
                            element: el
                        }))
                        .filter(x => x.text);

                return {
                    questionText,
                    questionImageUrl,
                    questionType:
                        'drag_into_blank',
                    draggableOptions,
                    dropZone: {
                        element: droppableBlanks[0]
                    }
                };
            }

            const matchContainer =
                document.querySelector(
                    '.match-order-options-container, .question-options-layout'
                );

            if (matchContainer) {
                const draggableItemElements =
                    Array.from(
                        matchContainer.querySelectorAll(
                            '.match-order-option.is-option-tile'
                        )
                    ).filter(isVisible);

                const dropZoneElements =
                    Array.from(
                        matchContainer.querySelectorAll(
                            '.match-order-option.is-drop-tile'
                        )
                    ).filter(isVisible);

                if (
                    draggableItemElements.length &&
                    dropZoneElements.length
                ) {
                    const isImageMatch =
                        draggableItemElements.some(
                            el =>
                                !!el.querySelector(
                                    '.option-image'
                                ) ||
                                el.dataset.type === 'image' ||
                                !!imageUrlFromElement(
                                    el.querySelector(
                                        '.option-image'
                                    )
                                )
                        );

                    if (isImageMatch) {
                        const draggableItems =
                            draggableItemElements
                                .map((el, i) => ({
                                    id: `IMAGEM ${i + 1}`,
                                    imageUrl:
                                        imageUrlFromElement(
                                            el.querySelector(
                                                '.option-image'
                                            ) || el
                                        ),
                                    element: el
                                }))
                                .filter(x => x.imageUrl);

                        const dropZones =
                            dropZoneElements
                                .map(el => ({
                                    text: textFromElement(el),
                                    element: el
                                }))
                                .filter(x => x.text);

                        return {
                            questionText,
                            questionImageUrl,
                            questionType:
                                'match_image_to_text',
                            draggableItems,
                            dropZones
                        };
                    }

                    const draggableItems =
                        draggableItemElements
                            .map(el => ({
                                text: textFromElement(el),
                                element: el
                            }))
                            .filter(x => x.text);

                    const dropZones =
                        dropZoneElements
                            .map(el => ({
                                text: textFromElement(el),
                                element: el
                            }))
                            .filter(x => x.text);

                    const questionType =
                        /reorder|ordem|sequenc/i.test(
                            questionText
                        )
                            ? 'reorder'
                            : 'match_order';

                    return {
                        questionText,
                        questionImageUrl,
                        questionType,
                        draggableItems,
                        dropZones
                    };
                }
            }

            const openEndedTextarea =
                document.querySelector(
                    'textarea[data-cy="open-ended-textarea"], textarea'
                );

            if (
                openEndedTextarea &&
                isVisible(openEndedTextarea)
            ) {
                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'open_ended',
                    answerElement: openEndedTextarea
                };
            }

            const options =
                extractOptions(container);

            if (options.length > 0) {
                const isMultipleChoice =
                    options.some(
                        el =>
                            el.element.classList.contains(
                                'is-msq'
                            ) ||
                            el.element.getAttribute(
                                'aria-multiselectable'
                            ) === 'true'
                    );

                return {
                    questionText,
                    questionImageUrl,
                    questionType:
                        isMultipleChoice
                            ? 'multiple_choice'
                            : 'single_choice',
                    options
                };
            }

            console.error(
                '[Nikolas v51.1] Tipo de questão não reconhecido.',
                {
                    questionText,
                    container
                }
            );

            return null;

        } catch (error) {
            console.error(
                '[Nikolas v51.1] Erro ao extrair dados:',
                error
            );

            return null;
        }
    }

    // ============================================================
    // IA — estrutura Gemini/OpenRouter preservada, com parsing robusto.
    // ============================================================
    async function obterRespostaDaIA(quizData) {
        lastAiResponse = '';

        let promptDeInstrucao = '';
        let formattedOptions = '';

        switch (quizData.questionType) {
            case 'multi_dropdown':
                promptDeInstrucao =
                    `Esta é uma questão com múltiplas lacunas ([RESPOSTA X]). As opções disponíveis são um pool compartilhado e cada opção só pode ser usada uma vez. Determine a resposta correta para CADA placeholder. Responda com cada resposta em uma nova linha, no formato '[RESPOSTA X]: Resposta Correta'.`;

                formattedOptions =
                    `Pool de Opções Disponíveis: ${quizData.allAvailableOptions.join(', ')}`;

                break;

            case 'match_image_to_text':
                promptDeInstrucao =
                    `Esta é uma questão de combinar imagens com seus textos correspondentes. Para cada imagem, forneça o par correto no formato EXATO: 'Texto da Opção -> ID da Imagem' (ex: 90° -> IMAGEM 3), um por linha.`;

                formattedOptions =
                    `Opções de Texto:\n${
                        quizData.dropZones
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'match_order':
                promptDeInstrucao =
                    `Responda com os pares no formato EXATO: 'Texto do Local para Soltar -> Texto do Item para Arrastar', um por linha.`;

                formattedOptions =
                    `Itens:\n${
                        quizData.draggableItems
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }\n\nLocais:\n${
                        quizData.dropZones
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'reorder':
                promptDeInstrucao =
                    `Forneça a ordem correta listando os textos dos itens, um por linha, do primeiro ao último.`;

                formattedOptions =
                    `Itens:\n${
                        quizData.draggableItems
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;
                            case 'multi_drag_into_blank':
                promptDeInstrucao =
                    `Responda com os pares no formato EXATO: 'Sentença da pergunta -> Expressão da opção', um por linha.`;

                formattedOptions =
                    `Sentenças:\n${
                        quizData.dropZones
                            .map(x => `- "${x.prompt}"`)
                            .join('\n')
                    }\n\nExpressões:\n${
                        quizData.draggableOptions
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'equation':
                promptDeInstrucao =
                    `Resolva a equação ou inequação. Forneça apenas a expressão final simplificada.`;

                formattedOptions =
                    `EQUAÇÃO: "${quizData.questionText}"`;

                break;

            case 'dropdown':
            case 'single_choice':
                promptDeInstrucao =
                    `Responda APENAS com o texto exato da ÚNICA alternativa correta.`;

                formattedOptions =
                    `OPÇÕES:\n${
                        quizData.options
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'drag_into_blank':
                promptDeInstrucao =
                    `Responda APENAS com o texto da ÚNICA opção correta que preenche a lacuna.`;

                formattedOptions =
                    `OPÇÕES:\n${
                        quizData.draggableOptions
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'multiple_choice':
                promptDeInstrucao =
                    `Responda APENAS com os textos exatos de TODAS as alternativas corretas, uma por linha.`;

                formattedOptions =
                    `OPÇÕES:\n${
                        quizData.options
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;

                break;

            case 'open_ended':
                promptDeInstrucao =
                    `Responda com a palavra ou frase curta que melhor responde à pergunta.`;

                break;
        }

        let textPrompt =
            `${promptDeInstrucao}\n\n---\nPERGUNTA: "${quizData.questionText}"\n---\n${formattedOptions}`;

        let base64Image =
            quizData.questionImageUrl
                ? await imageUrlToBase64(
                    quizData.questionImageUrl
                )
                : null;

        if (
            currentAiProvider === 'deepseek' &&
            (
                base64Image ||
                quizData.questionType ===
                    'match_image_to_text'
            )
        ) {
            console.warn(
                '[Nikolas v51.1] DeepSeek não processa as imagens enviadas pelo script. A questão seguirá sem a imagem.'
            );

            base64Image = null;

            if (
                quizData.questionType ===
                'match_image_to_text'
            ) {
                quizData.draggableItems =
                    quizData.draggableItems.map(
                        item => ({
                            ...item,
                            text: item.id
                        })
                    );

                textPrompt =
                    `Responda com os pares no formato EXATO: 'Texto do Local para Soltar -> ID da Imagem'.\n\nPERGUNTA: "${quizData.questionText}"\n\nItens:\n${
                        quizData.draggableItems
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }\n\nLocais:\n${
                        quizData.dropZones
                            .map(x => `- "${x.text}"`)
                            .join('\n')
                    }`;
            }
        }

        let aiResponseText = null;

        if (currentAiProvider === 'gemini') {
            for (
                let i = 0;
                i < GEMINI_API_KEYS.length;
                i++
            ) {
                const currentKey =
                    GEMINI_API_KEYS[
                        currentApiKeyIndex
                    ];

                if (
                    !currentKey ||
                    currentKey.includes('CHAVE_') ||
                    currentKey.includes('SUA_') ||
                    currentKey.length < 30
                ) {
                    currentApiKeyIndex =
                        (
                            currentApiKeyIndex + 1
                        ) %
                        GEMINI_API_KEYS.length;

                    continue;
                }

                const API_URL =
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`;

                const promptParts = [
                    {
                        text: textPrompt
                    }
                ];

                if (base64Image) {
                    const parsed =
                        parseDataUrl(base64Image);

                    if (parsed) {
                        promptParts.push({
                            inline_data: {
                                mime_type:
                                    parsed.mimeType,
                                data:
                                    parsed.data
                            }
                        });
                    }
                }

                if (
                    quizData.questionType ===
                    'match_image_to_text'
                ) {
                    promptParts.push({
                        text:
                            '\n\nIMAGENS (Itens para Arrastar):\n'
                    });

                    for (
                        const item of
                        quizData.draggableItems
                    ) {
                        const base64 =
                            await imageUrlToBase64(
                                item.imageUrl
                            );

                        const parsed =
                            base64
                                ? parseDataUrl(base64)
                                : null;

                        if (parsed) {
                            promptParts.push({
                                inline_data: {
                                    mime_type:
                                        parsed.mimeType,
                                    data:
                                        parsed.data
                                }
                            });

                            promptParts.push({
                                text: `- ${item.id}`
                            });
                        }
                    }
                }

                try {
                    const response =
                        await fetchWithTimeout(
                            API_URL,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type':
                                        'application/json'
                                },
                                body: JSON.stringify({
                                    contents: [
                                        {
                                            parts:
                                                promptParts
                                        }
                                    ]
                                })
                            }
                        );

                    if (response.ok) {
                        const data =
                            await response.json();

                        aiResponseText =
                            extractGeminiText(data);

                        if (aiResponseText) {
                            break;
                        }

                        console.warn(
                            '[Nikolas v51.1] Gemini respondeu sem texto utilizável.',
                            data
                        );
                    } else {
                        const errorData =
                            await safeJson(response);

                        console.warn(
                            `[Nikolas v51.1] Gemini #${currentApiKeyIndex + 1}: ${
                                errorData?.error?.message ||
                                `HTTP ${response.status}`
                            }`
                        );
                    }

                } catch (error) {
                    console.warn(
                        `[Nikolas v51.1] Erro Gemini #${currentApiKeyIndex + 1}: ${error.message}`
                    );
                }

                currentApiKeyIndex =
                    (
                        currentApiKeyIndex + 1
                    ) %
                    GEMINI_API_KEYS.length;
            }

        } else {
            for (
                let i = 0;
                i < OPENROUTER_API_KEYS.length;
                i++
            ) {
                const currentKey =
                    OPENROUTER_API_KEYS[
                        currentOpenRouterKeyIndex
                    ];

                if (
                    !currentKey ||
                    currentKey.includes('SUA_') ||
                    currentKey.length < 30
                ) {
                    currentOpenRouterKeyIndex =
                        (
                            currentOpenRouterKeyIndex + 1
                        ) %
                        OPENROUTER_API_KEYS.length;

                    continue;
                }

                const API_URL =
                    'https://openrouter.ai/api/v1/chat/completions';

                try {
                    const response =
                        await fetchWithTimeout(
                            API_URL,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type':
                                        'application/json',
                                    'Authorization':
                                        `Bearer ${currentKey}`,
                                    'HTTP-Referer':
                                        'https://github.com/Nikolas0508',
                                    'X-Title':
                                        'Nikolas Quizizz'
                                },
                                body: JSON.stringify({
                                    model:
                                        DEEPSEEK_MODEL_NAME,
                                    messages: [
                                        {
                                            role: 'user',
                                            content:
                                                textPrompt
                                        }
                                    ],
                                    max_tokens: 1024
                                })
                            }
                        );

                    if (response.ok) {
                        const data =
                            await response.json();

                        aiResponseText =
                            data?.choices
                                ?.map(
                                    x =>
                                        x?.message?.content
                                )
                                .filter(Boolean)
                                .join('\n') ||
                            null;

                        if (aiResponseText) {
                            break;
                        }

                    } else {
                        const errorData =
                            await safeJson(response);

                        console.warn(
                            `[Nikolas v51.1] OpenRouter #${currentOpenRouterKeyIndex + 1}: ${
                                errorData?.error?.message ||
                                `HTTP ${response.status}`
                            }`
                        );
                    }

                } catch (error) {
                    console.warn(
                        `[Nikolas v51.1] Erro OpenRouter #${currentOpenRouterKeyIndex + 1}: ${error.message}`
                    );
                }

                currentOpenRouterKeyIndex =
                    (
                        currentOpenRouterKeyIndex + 1
                    ) %
                    OPENROUTER_API_KEYS.length;
            }
        }

        if (!aiResponseText) {
            throw new Error(
                `A IA não retornou uma resposta utilizável (${currentAiProvider}).`
            );
        }

        lastAiResponse =
            aiResponseText.trim();

        console.log(
            '[Nikolas v51.1] Resposta bruta da IA:',
            lastAiResponse
        );

        return lastAiResponse;
    }

    function extractGeminiText(data) {
        const parts =
            data?.candidates?.flatMap(
                c =>
                    c?.content?.parts || []
            ) || [];

        return parts
            .map(p => p?.text)
            .filter(Boolean)
            .join('\n')
            .trim() || null;
    }

    async function safeJson(response) {
        try {
            return await response.json();
        } catch (_) {
            return null;
        }
    }

    function parseDataUrl(value) {
        const match =
            String(value || '').match(
                /^data:([^;,]+);base64,(.+)$/s
            );

        if (!match) return null;

        const allowed = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif'
        ];

        return {
            mimeType:
                allowed.includes(match[1])
                    ? match[1]
                    : 'image/jpeg',
            data: match[2]
        };
    }

    // ============================================================
    // RESULTADO — somente exibe. Não seleciona nem envia respostas.
    // ============================================================
    function showResult(answer, quizData) {
        const old =
            document.getElementById(
                'nikolas-result-toast'
            );

        if (old) old.remove();

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
                    'min(520px, calc(100vw - 40px))',
                maxHeight: '45vh',
                overflow: 'auto',
                padding: '14px 16px',
                borderRadius: '14px',
                color: '#fff',
                background:
                    'rgba(12,16,22,.94)',
                border:
                    '1px solid rgba(0,255,255,.45)',
                boxShadow:
                    '0 0 25px rgba(0,255,255,.18)',
                font:
                    '14px/1.45 system-ui,sans-serif',
                whiteSpace: 'pre-wrap',
                backdropFilter: 'blur(10px)'
            }
        );

        const title =
            document.createElement('div');

        title.textContent =
            `✓ ${quizData.questionType.replaceAll('_', ' ')} — resposta da IA`;

        title.style.fontWeight =
            '700';

        title.style.marginBottom =
            '8px';

        title.style.color =
            '#66ffff';

        const body =
            document.createElement('div');

        body.textContent =
            answer;

        box.append(
            title,
            body
        );

        document.body.appendChild(
            box
        );

        setTimeout(
            () => box.remove(),
            12000
        );
    }
        async function performAction(
        aiAnswerText,
        quizData
    ) {
        if (!aiAnswerText) return;

        console.log(
            '[Nikolas v51.1] Resultado pronto:',
            {
                type:
                    quizData.questionType,
                answer:
                    aiAnswerText
            }
        );

        showResult(
            aiAnswerText,
            quizData
        );
    }

    // ============================================================
    // CURSOR / STATUS
    // ============================================================
    function setCursorState(state) {
        document.documentElement.dataset.nikolasCursor =
            state;

        const old =
            document.getElementById(
                'nikolas-cursor-style'
            );

        if (old) old.remove();

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

        document.head.appendChild(
            style
        );
    }

    function showStatus(
        text,
        error = false
    ) {
        const old =
            document.getElementById(
                'nikolas-status'
            );

        if (old) old.remove();

        const el =
            document.createElement('div');

        el.id =
            'nikolas-status';

        el.textContent =
            text;

        Object.assign(
            el.style,
            {
                position: 'fixed',
                left: '50%',
                top: '18px',
                transform:
                    'translateX(-50%)',
                zIndex:
                    '2147483647',
                padding:
                    '8px 14px',
                borderRadius:
                    '999px',
                background:
                    'rgba(10,14,18,.9)',
                border:
                    `1px solid ${
                        error
                            ? '#ff3b6b'
                            : '#00ffff'
                    }`,
                color: '#fff',
                font:
                    '600 12px system-ui',
                pointerEvents:
                    'none'
            }
        );

        document.body.appendChild(
            el
        );

        setTimeout(
            () => el.remove(),
            1800
        );
    }

    async function resolverQuestao() {
        if (busy) return;

        busy = true;

        setCursorState(
            'processing'
        );

        showStatus(
            'Analisando questão...'
        );

        try {
            const quizData =
                await extrairDadosDaQuestao();

            if (!quizData) {
                throw new Error(
                    'Não foi possível extrair a questão.'
                );
            }

            const fingerprint =
                `${quizData.questionType}|${quizData.questionText}|${
                    quizData.options
                        ?.map(x => x.text)
                        .join('|') || ''
                }`;

            lastQuestionFingerprint =
                fingerprint;

            console.log(
                '[Nikolas v51.1] Dados extraídos:',
                quizData
            );

            showStatus(
                'Enviando para a IA...'
            );

            const aiAnswer =
                await obterRespostaDaIA(
                    quizData
                );

            await performAction(
                aiAnswer,
                quizData
            );

            setCursorState(
                'success'
            );

            showStatus(
                'Resposta recebida.'
            );

            await sleep(
                1000
            );

        } catch (error) {
            console.error(
                '[Nikolas v51.1] Falha:',
                error
            );

            setCursorState(
                'error'
            );

            showStatus(
                'Falha ao analisar — veja o Console (F12).',
                true
            );

            await sleep(
                1200
            );

        } finally {
            setCursorState(
                'normal'
            );

            busy = false;
        }
    }

    // ============================================================
    // ATALHO: ESPAÇO
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
                target &&
                (
                    target.matches?.(
                        'input, textarea, select, [contenteditable="true"]'
                    ) ||
                    target.closest?.(
                        'input,textarea,select,[contenteditable="true"]'
                    )
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
    // IMAGENS / FETCH
    // ============================================================
    async function imageUrlToBase64(url) {
        if (!url) return null;

        if (
            /^data:image\//i.test(url)
        ) {
            return url;
        }

        if (
            /^blob:/i.test(url)
        ) {
            try {
                const response =
                    await fetchWithTimeout(
                        url,
                        {
                            cache:
                                'no-store'
                        }
                    );

                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                const blob =
                    await response.blob();

                if (
                    !blob.type.startsWith(
                        'image/'
                    )
                ) {
                    throw new Error(
                        `Tipo recebido: ${
                            blob.type ||
                            'desconhecido'
                        }`
                    );
                }

                return await blobToDataUrl(
                    blob
                );

            } catch (e) {
                console.warn(
                    '[Nikolas v51.1] Falha em blob:',
                    e.message
                );

                return null;
            }
        }

        try {
            const parsed =
                new URL(
                    url,
                    location.href
                );

            parsed.searchParams.set(
                '_nikolas',
                Date.now().toString()
            );

            const response =
                await fetchWithTimeout(
                    parsed.href,
                    {
                        cache:
                            'no-store',
                        credentials:
                            'omit'
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const blob =
                await response.blob();

            if (
                !blob.type.startsWith(
                    'image/'
                )
            ) {
                throw new Error(
                    `Resposta não é imagem (${
                        blob.type ||
                        'tipo desconhecido'
                    })`
                );
            }

            return await blobToDataUrl(
                blob
            );

        } catch (e) {
            console.warn(
                '[Nikolas v51.1] Não foi possível baixar imagem:',
                url,
                e.message
            );

            return null;
        }
    }

    function blobToDataUrl(blob) {
        return new Promise(
            (resolve, reject) => {
                const reader =
                    new FileReader();

                reader.onload =
                    () =>
                        resolve(
                            reader.result
                        );

                reader.onerror =
                    reject;

                reader.readAsDataURL(
                    blob
                );
            }
        );
    }

    async function fetchWithTimeout(
        resource,
        options = {},
        timeout = 15000
    ) {
        const controller =
            new AbortController();

        const id =
            setTimeout(
                () =>
                    controller.abort(),
                timeout
            );

        try {
            return await fetch(
                resource,
                {
                    ...options,
                    signal:
                        controller.signal
                }
            );

        } catch (error) {
            if (
                error.name ===
                'AbortError'
            ) {
                throw new Error(
                    'Timeout na requisição.'
                );
            }

            throw error;

        } finally {
            clearTimeout(id);
        }
    }

    // ============================================================
    // DETECTOR DE QUIZ ID (mantido para compatibilidade)
    // ============================================================
    function logQuizId(
        id,
        source
    ) {
        if (
            id === quizIdDetected
        ) {
            return;
        }

        quizIdDetected =
            id;

        console.log(
            `[Quizizz Bypass] Novo Quiz ID detectado (${source}): ${id}`
        );
    }

    function detectQuizIdFromURL() {
        const match =
            location.pathname.match(
                regexQuizId
            );

        return match
            ? match[1]
            : null;
    }

    function interceptFetch() {
        const originalFetch =
            window.fetch;

        if (
            originalFetch.__nikolasWrapped
        ) {
            return;
        }

        const wrapped =
            async function (...args) {
                const resource =
                    args[0];

                const url =
                    typeof resource ===
                    'string'
                        ? resource
                        : resource?.url;

                if (url) {
                    const match =
                        String(url).match(
                            regexQuizId
                        );

                    if (match) {
                        logQuizId(
                            match[1],
                            'fetch'
                        );
                    }
                }

                return originalFetch.apply(
                    this,
                    args
                );
            };

        wrapped.__nikolasWrapped =
            true;

        window.fetch =
            wrapped;
    }

    function interceptXHR() {
        const originalOpen =
            XMLHttpRequest
                .prototype
                .open;

        if (
            originalOpen.__nikolasWrapped
        ) {
            return;
        }

        function wrapped(
            method,
            url
        ) {
            if (
                typeof url ===
                'string'
            ) {
                const match =
                    url.match(
                        regexQuizId
                    );

                if (match) {
                    logQuizId(
                        match[1],
                        'XHR'
                    );
                }
            }

            return originalOpen.apply(
                this,
                arguments
            );
        }

        wrapped.__nikolasWrapped =
            true;

        XMLHttpRequest
            .prototype
            .open =
            wrapped;
    }

    function initQuizIdDetector() {
        const id =
            detectQuizIdFromURL();

        if (id) {
            logQuizId(
                id,
                'URL'
            );
        }

        if (
            !interceptorsStarted
        ) {
            interceptFetch();
            interceptXHR();
            interceptorsStarted =
                true;
        }
    }

    (function monitorSPA() {
        const pushState =
            history.pushState;

        history.pushState =
            function () {
                const result =
                    pushState.apply(
                        this,
                        arguments
                    );

                setTimeout(
                    initQuizIdDetector,
                    300
                );

                return result;
            };

        addEventListener(
            'popstate',
            () =>
                setTimeout(
                    initQuizIdDetector,
                    300
                )
        );
    })();

    // ============================================================
    // INÍCIO
    // ============================================================
    setCursorState(
        'normal'
    );

    initQuizIdDetector();

    console.log(
        '[Nikolas v51.1] Carregado. Pressione ESPAÇO para analisar a questão.'
    );

})();
