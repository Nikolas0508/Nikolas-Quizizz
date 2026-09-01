// ==UserScript==
// @name         Nikolas Quizizz
// @version      51.0
// @description  Assistente de estudo para Wayground com Gemini
// @author       Nikolas
// @icon         https://tse1.mm.bing.net/th/id/OIP.Ydweh29BuHk_PGD4dGJXbAHaHa?rs=1&pid=ImgDetMain&o=7&rm=3
// @match        https://wayground.com/join/game/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // -----------------------------------------------------------------------------------
    // IMPORTANTE: LISTA DE CHAVES DE API
    // -----------------------------------------------------------------------------------
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

    const regexQuizId = /\/(?:quiz|quizzes|admin\/quiz|games|attempts|join)\/([a-f0-9]{24})/i;
    let quizIdDetected = null;
    let interceptorsStarted = false;

    function waitForElement(selector, all = false, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const interval = setInterval(() => {
                const elements = all
                    ? document.querySelectorAll(selector)
                    : document.querySelector(selector);

                if ((all && elements.length > 0) || (!all && elements)) {
                    clearInterval(interval);
                    resolve(elements);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(
                        `Elemento(s) "${selector}" não encontrado(s) após ${timeout / 1000} segundos.`
                    ));
                }
            }, 100);
        });
    }

    function waitForElementToDisappear(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const interval = setInterval(() => {
                const element = document.querySelector(selector);

                if (!element) {
                    clearInterval(interval);
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(
                        `Elemento "${selector}" não desapareceu após ${timeout / 1000} segundos.`
                    ));
                }
            }, 100);
        });
    }

    async function extrairDadosDaQuestao() {
        try {
            const questionTextElement = document.querySelector('#questionText');

            const questionText = questionTextElement
                ? questionTextElement.innerText.trim().replace(/\s+/g, ' ')
                : "Não foi possível encontrar o texto da pergunta.";

            const questionRoot =
                document.querySelector('#questionText')?.closest(
                    '[data-testid="question-container"], .question-container, main, section'
                ) ||
                document.querySelector('#questionText')?.parentElement ||
                document.body;

            const imageCandidates = Array.from(
                questionRoot.querySelectorAll(
                    'img[data-testid="question-container-image"], img[src], img[srcset], [style*="background-image"]'
                )
            );

            let questionImageUrl = null;

            const explicitImage = imageCandidates.find(el =>
                el.matches('img[data-testid="question-container-image"]')
            );

            if (explicitImage?.src) {
                questionImageUrl = explicitImage.src;
            } else {
                const img = imageCandidates.find(el => {
                    if (el.tagName === 'IMG') {
                        const src = el.currentSrc || el.src;

                        if (!src || /avatar|logo|icon|emoji/i.test(src)) {
                            return false;
                        }

                        const r = el.getBoundingClientRect();

                        return r.width >= 80 && r.height >= 50;
                    }

                    const bg = getComputedStyle(el).backgroundImage;

                    return bg &&
                           bg !== 'none' &&
                           /url\(/i.test(bg);
                });

                if (img) {
                    if (img.tagName === 'IMG') {
                        questionImageUrl = img.currentSrc || img.src || null;
                    } else {
                        const bg = getComputedStyle(img).backgroundImage;
                        const match = bg.match(/url\(["']?(.+?)["']?\)/i);

                        questionImageUrl = match
                            ? match[1]
                            : null;
                    }
                }
            }

            const extractText = (el) => {
                const mathElement = el.querySelector(
                    'annotation[encoding="application/x-tex"]'
                );

                return mathElement
                    ? mathElement.textContent.trim()
                    : el.querySelector('#optionText')?.innerText.trim() || '';
            };

            const dropdownButtons = document.querySelectorAll(
                'button.options-dropdown'
            );

            if (dropdownButtons.length > 1) {
                console.log("Tipo Múltiplos Dropdowns detectado.");

                const dropdowns = [];
                let questionTextWithPlaceholders =
                    questionTextElement.innerHTML;

                const popperSelector =
                    '.v-popper__popper--shown';

                dropdownButtons.forEach((btn, i) => {
                    const placeholder =
                        ` [RESPOSTA ${i + 1}] `;

                    const wrapper =
                        btn.closest('.dropdown-wrapper');

                    if (wrapper) {
                        questionTextWithPlaceholders =
                            questionTextWithPlaceholders.replace(
                                wrapper.outerHTML,
                                placeholder
                            );
                    }
                });

                const tempDiv =
                    document.createElement('div');

                tempDiv.innerHTML =
                    questionTextWithPlaceholders;

                const cleanQuestionText =
                    tempDiv.innerText.replace(/\s+/g, ' ');

                let allAvailableOptions = [];

                const firstBtn = dropdownButtons[0];

                firstBtn.click();

                try {
                    const optionElements =
                        await waitForElement(
                            `${popperSelector} button.dropdown-option`,
                            true,
                            2000
                        );

                    allAvailableOptions =
                        Array.from(optionElements).map(
                            el => el.innerText.trim()
                        );

                    console.log(
                        "Pool de opções detectado:",
                        allAvailableOptions
                    );
                } catch (e) {
                    console.error(
                        "Falha ao ler o pool de opções do primeiro dropdown.",
                        e
                    );

                    if (document.querySelector(popperSelector)) {
                        document.body.click();
                    }
                }

                if (document.querySelector(popperSelector)) {
                    document.body.click();
                }

                try {
                    await waitForElementToDisappear(
                        popperSelector,
                        2000
                    );
                } catch (e) {
                    console.warn(
                        "Popper não fechou, mas continuando..."
                    );
                }

                dropdownButtons.forEach((btn, i) => {
                    dropdowns.push({
                        button: btn,
                        placeholder: `[RESPOSTA ${i + 1}]`
                    });
                });

                console.log(
                    "Texto Limpo Enviado para IA:",
                    cleanQuestionText
                );

                return {
                    questionText: cleanQuestionText,
                    questionImageUrl,
                    questionType: 'multi_dropdown',
                    dropdowns,
                    allAvailableOptions
                };
            }

            if (dropdownButtons.length === 1) {
                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'dropdown',
                    dropdownButton: dropdownButtons[0]
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
                document.querySelectorAll(
                    'button.droppable-blank'
                );

            const dragOptions =
                document.querySelectorAll(
                    '.drag-option'
                );

            if (
                droppableBlanks.length > 1 &&
                dragOptions.length > 0
            ) {
                const questionContainer =
                    document.querySelector(
                        '.drag-drop-text > div'
                    );

                const dropZones = [];

                if (questionContainer) {
                    const children =
                        Array.from(
                            questionContainer.children
                        );

                    for (
                        let i = 0;
                        i < children.length;
                        i++
                    ) {
                        const blankButton =
                            children[i].querySelector(
                                'button.droppable-blank'
                            );

                        if (blankButton) {
                            const precedingSpan =
                                children[i - 1];

                            if (
                                precedingSpan &&
                                precedingSpan.tagName === 'SPAN'
                            ) {
                                let promptText =
                                    precedingSpan.innerText
                                        .trim()
                                        .replace(/:\s*$/, '')
                                        .replace(/\s+/g, ' ');

                                dropZones.push({
                                    prompt: promptText,
                                    blankElement: blankButton
                                });
                            }
                        }
                    }
                }

                const draggableOptions =
                    Array.from(dragOptions).map(el => ({
                        text: el.innerText.trim(),
                        element: el
                    }));

                return {
                    questionText:
                        questionContainer.innerText.trim(),
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
                    Array.from(dragOptions).map(el => ({
                        text:
                            el.querySelector(
                                '.dnd-option-text'
                            )?.innerText.trim() || '',
                        element: el
                    }));

                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'drag_into_blank',
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
                    );

                const dropZoneElements =
                    Array.from(
                        matchContainer.querySelectorAll(
                            '.match-order-option.is-drop-tile'
                        )
                    );

                const isImageMatch =
                    draggableItemElements.length > 0 &&
                    (
                        draggableItemElements[0]
                            .querySelector('.option-image') ||
                        draggableItemElements[0]
                            .dataset.type === 'image'
                    );

                if (isImageMatch) {
                    console.log(
                        "Tipo Match-Order (Imagem p/ Texto) detectado."
                    );

                    const draggableItems = [];

                    for (
                        let i = 0;
                        i < draggableItemElements.length;
                        i++
                    ) {
                        const el =
                            draggableItemElements[i];

                        const imgDiv =
                            el.querySelector('.option-image');

                        const style =
                            imgDiv
                                ? window.getComputedStyle(
                                      imgDiv
                                  ).backgroundImage
                                : null;

                        const urlMatch =
                            style
                                ? style.match(
                                      /url\("(.+?)"\)/
                                  )
                                : null;

                        let imageUrl =
                            urlMatch
                                ? urlMatch[1]
                                : null;

                        if (!imageUrl) {
                            const dataCy =
                                el.dataset.cy;

                            if (
                                dataCy &&
                                dataCy.includes('url(')
                            ) {
                                const urlMatchCy =
                                    dataCy.match(
                                        /url\((.+)\)/
                                    );

                                if (urlMatchCy) {
                                    imageUrl =
                                        urlMatchCy[1]
                                            .replace(
                                                /\?w=\d+&h=\d+$/,
                                                ''
                                            );
                                }
                            }
                        }

                        if (imageUrl) {
                            draggableItems.push({
                                id: `IMAGEM ${i + 1}`,
                                imageUrl,
                                element: el
                            });
                        }
                    }

                    const dropZones =
                        dropZoneElements.map(el => ({
                            text: extractText(el),
                            element: el
                        }));

                    return {
                        questionText,
                        questionImageUrl,
                        questionType:
                            'match_image_to_text',
                        draggableItems,
                        dropZones
                    };

                } else if (
                    draggableItemElements.length > 0 &&
                    dropZoneElements.length > 0
                ) {
                    const draggableItems =
                        draggableItemElements.map(el => ({
                            text: extractText(el),
                            element: el
                        }));

                    const dropZones =
                        dropZoneElements.map(el => ({
                            text: extractText(el),
                            element: el
                        }));

                    const questionType =
                        questionText
                            .toLowerCase()
                            .includes('reorder')
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
                    'textarea[data-cy="open-ended-textarea"]'
                );

            if (openEndedTextarea) {
                return {
                    questionText,
                    questionImageUrl,
                    questionType: 'open_ended',
                    answerElement:
                        openEndedTextarea
                };
            }

            const optionElements =
                document.querySelectorAll(
                    '.option.is-selectable'
                );

            if (optionElements.length > 0) {
                const isMultipleChoice =
                    Array.from(optionElements).some(
                        el => el.classList.contains('is-msq')
                    );

                const options =
                    Array.from(optionElements).map(el => ({
                        text: extractText(el),
                        element: el
                    }));

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
                "Tipo de questão não reconhecido."
            );

            return null;

        } catch (error) {
            console.error(
                "Erro ao extrair dados da questão:",
                error
            );

            return null;
        }
    }
        async function obterRespostaDaIA(quizData) {
        lastAiResponse = '';

        const viewResponseBtn =
            document.getElementById(
                'view-raw-response-btn'
            );

        if (viewResponseBtn) {
            viewResponseBtn.style.display = 'none';
        }

        let promptDeInstrucao = "";
        let formattedOptions = "";

        switch (quizData.questionType) {

            case 'multi_dropdown':
                promptDeInstrucao =
                    `Esta é uma questão com múltiplas lacunas ([RESPOSTA X]). As opções disponíveis são um pool compartilhado e cada opção só pode ser usada uma vez. Determine a resposta correta para CADA placeholder. Responda com cada resposta em uma nova linha, no formato '[RESPOSTA X]: Resposta Correta'. Se algum placeholder não tiver uma resposta lógica no pool (ex: está fora da sequência), omita-o da resposta.`;

                formattedOptions =
                    "Pool de Opções Disponíveis: " +
                    quizData.allAvailableOptions.join(', ');

                break;

            case 'match_image_to_text':
                promptDeInstrucao =
                    `Esta é uma questão de combinar imagens com seus textos correspondentes. Para cada imagem, forneça o par correto no formato EXATO: 'Texto da Opção -> ID da Imagem' (ex: 90° -> IMAGEM 3), com cada par em uma nova linha.`;

                const dropZoneTexts =
                    quizData.dropZones
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                formattedOptions =
                    `Opções de Texto (Locais para Soltar):\n${dropZoneTexts}`;

                break;

            case 'match_order':
                promptDeInstrucao =
                    `Responda com os pares no formato EXATO: 'Texto do Local para Soltar -> Texto do Item para Arrastar', com cada par em uma nova linha.`;

                const draggables =
                    quizData.draggableItems
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                const droppables =
                    quizData.dropZones
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                formattedOptions =
                    `Itens para Arrastar:\n${draggables}\n\nLocais para Soltar:\n${droppables}`;

                break;

            case 'multi_drag_into_blank':
                promptDeInstrucao =
                    `Esta é uma questão de combinar múltiplas sentenças com suas expressões corretas. Responda com os pares no formato EXATO: 'Sentença da pergunta -> Expressão da opção', com cada par em uma nova linha.`;

                const prompts =
                    quizData.dropZones
                        .map(item => `- "${item.prompt}"`)
                        .join('\n');

                const options =
                    quizData.draggableOptions
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                formattedOptions =
                    `Sentenças:\n${prompts}\n\nExpressões (Opções):\n${options}`;

                break;

            case 'equation':
                promptDeInstrucao =
                    `Resolva a seguinte equação ou inequação. Forneça apenas a expressão final simplificada (ex: x = 5, ou y > 3).`;

                formattedOptions =
                    `EQUAÇÃO: "${quizData.questionText}"`;

                break;

            case 'dropdown':
            case 'single_choice':
                promptDeInstrucao =
                    `Responda APENAS com o texto exato da ÚNICA alternativa correta.`;

                formattedOptions =
                    "OPÇÕES:\n" +
                    quizData.options
                        .map(opt => `- "${opt.text}"`)
                        .join('\n');

                break;

            case 'reorder':
                promptDeInstrucao =
                    `A tarefa é: "${quizData.questionText}". Forneça a ordem correta listando os textos dos itens, um por linha, do primeiro ao último.`;

                formattedOptions =
                    "Itens para ordenar:\n" +
                    quizData.draggableItems
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                break;

            case 'drag_into_blank':
                promptDeInstrucao =
                    `Responda APENAS com o texto da ÚNICA opção correta que preenche a lacuna.`;

                formattedOptions =
                    "Opções para arrastar:\n" +
                    quizData.draggableOptions
                        .map(item => `- "${item.text}"`)
                        .join('\n');

                break;

            case 'open_ended':
                promptDeInstrucao =
                    `Responda APENAS com a palavra ou frase curta que preenche a lacuna.`;

                break;

            case 'multiple_choice':
                promptDeInstrucao =
                    `Responda APENAS com os textos exatos de TODAS as alternativas corretas, separando cada uma em uma NOVA LINHA.`;

                formattedOptions =
                    "OPÇÕES:\n" +
                    quizData.options
                        .map(opt => `- "${opt.text}"`)
                        .join('\n');

                break;
        }

        let textPrompt =
            `${promptDeInstrucao}\n\n---\nPERGUNTA: "${quizData.questionText}"\n---\n${formattedOptions}`;

        let base64Image = null;

        if (quizData.questionImageUrl) {
            base64Image =
                await imageUrlToBase64(
                    quizData.questionImageUrl
                );
        }

        const hasDraggableImages =
            quizData.questionType ===
            'match_image_to_text';

        if (
            currentAiProvider === 'deepseek' &&
            (base64Image || hasDraggableImages)
        ) {
            console.warn(
                "DeepSeek não suporta imagens. Mostrando aviso..."
            );

            try {
                const acaoUsuario =
                    await mostrarAvisoDeepSeekImagem();

                if (acaoUsuario === 'gemini') {
                    console.log(
                        "Usuário escolheu usar Gemini."
                    );

                    currentAiProvider = 'gemini';

                } else if (
                    acaoUsuario === 'sem_imagem'
                ) {
                    console.log(
                        "Usuário escolheu enviar para o DeepSeek sem a imagem."
                    );

                    base64Image = null;

                    if (
                        quizData.questionType ===
                        'match_image_to_text'
                    ) {
                        quizData.questionType =
                            'match_order';

                        quizData.draggableItems =
                            quizData.draggableItems.map(
                                item => ({
                                    text: item.id,
                                    element: item.element
                                })
                            );

                        promptDeInstrucao =
                            `Responda com os pares no formato EXATO: 'Texto do Local para Soltar -> ID da Imagem' (ex: 90° -> IMAGEM 3), com cada par em uma nova linha.`;

                        const draggables =
                            quizData.draggableItems
                                .map(
                                    item =>
                                        `- "${item.text}"`
                                )
                                .join('\n');

                        const droppables =
                            quizData.dropZones
                                .map(
                                    item =>
                                        `- "${item.text}"`
                                )
                                .join('\n');

                        formattedOptions =
                            `Itens para Arrastar (IDs):\n${draggables}\n\nLocais para Soltar:\n${droppables}`;

                        textPrompt =
                            `${promptDeInstrucao}\n\n---\nPERGUNTA: "${quizData.questionText}"\n---\n${formattedOptions}`;
                    }
                }

            } catch (error) {
                console.error(error.message);
                throw error;
            }
        }

        try {
            let aiResponseText = null;

            if (currentAiProvider === 'gemini') {
                console.log(
                    "Usando Provedor: Gemini"
                );

                let geminiKeyFailed = false;

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
                        currentKey.includes("SUA_") ||
                        currentKey.length < 30
                    ) {
                        console.warn(
                            `Chave de API Gemini #${currentApiKeyIndex + 1} parece ser um placeholder. Pulando...`
                        );

                        currentApiKeyIndex =
                            (currentApiKeyIndex + 1) %
                            GEMINI_API_KEYS.length;

                        continue;
                    }

                    const API_URL =
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentKey}`;

                    let promptParts = [
                        {
                            text: textPrompt
                        }
                    ];

                    if (base64Image) {
                        const [
                            header,
                            data
                        ] =
                            base64Image.split(',');

                        let mimeType =
                            header.match(
                                /:(.*?);/
                            )[1];

                        if (
                            ![
                                'image/jpeg',
                                'image/png',
                                'image/webp'
                            ].includes(mimeType)
                        ) {
                            mimeType =
                                'image/jpeg';
                        }

                        promptParts.push({
                            inline_data: {
                                mime_type:
                                    mimeType,
                                data:
                                    data
                            }
                        });
                    }

                    if (
                        quizData.questionType ===
                        'match_image_to_text'
                    ) {
                        promptParts.push({
                            text:
                                "\n\nIMAGENS (Itens para Arrastar):\n"
                        });

                        for (
                            const item of
                            quizData.draggableItems
                        ) {
                            const base64 =
                                await imageUrlToBase64(
                                    item.imageUrl
                                );

                            if (base64) {
                                const [
                                    header,
                                    data
                                ] =
                                    base64.split(',');

                                let mimeType =
                                    header.match(
                                        /:(.*?);/
                                    )[1];

                                if (
                                    ![
                                        'image/jpeg',
                                        'image/png',
                                        'image/webp'
                                    ].includes(
                                        mimeType
                                    )
                                ) {
                                    mimeType =
                                        'image/jpeg';
                                }

                                promptParts.push({
                                    inline_data: {
                                        mime_type:
                                            mimeType,
                                        data:
                                            data
                                    }
                                });

                                promptParts.push({
                                    text:
                                        `- ${item.id}`
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
                                    body:
                                        JSON.stringify({
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
                                data.candidates[0]
                                    .content.parts[0]
                                    .text;

                            console.log(
                                `Sucesso com a Chave API Gemini #${currentApiKeyIndex + 1}.`
                            );

                            break;
                        }

                        const errorData =
                            await response.json();

                        const errorMessage =
                            errorData.error?.message ||
                            `Erro ${response.status}`;

                        console.warn(
                            `Chave API Gemini #${currentApiKeyIndex + 1} falhou: ${errorMessage}. Tentando a próxima...`
                        );

                        lastAiResponse =
                            `Falha na Chave Gemini #${currentApiKeyIndex + 1}: ${errorMessage}`;

                    } catch (error) {
                        console.warn(
                            `Erro na requisição com a Chave API Gemini #${currentApiKeyIndex + 1}: ${error.message}. Tentando a próxima...`
                        );

                        lastAiResponse =
                            `Falha na Chave Gemini #${currentApiKeyIndex + 1}: ${error.message}`;
                    }

                    currentApiKeyIndex =
                        (currentApiKeyIndex + 1) %
                        GEMINI_API_KEYS.length;

                    if (
                        i ===
                        GEMINI_API_KEYS.length - 1
                    ) {
                        geminiKeyFailed = true;
                    }
                }

                if (
                    !aiResponseText &&
                    geminiKeyFailed
                ) {
                    throw new Error(
                        "Todas as chaves de API do Gemini falharam."
                    );
                }

            } else if (
                currentAiProvider === 'deepseek'
            ) {
                console.log(
                    "Usando Provedor: DeepSeek (via OpenRouter)"
                );

                let deepseekKeyFailed = false;

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
                        currentKey.includes("SUA_") ||
                        currentKey.length < 30
                    ) {
                        console.warn(
                            `Chave OpenRouter #${currentOpenRouterKeyIndex + 1} parece ser um placeholder. Pulando...`
                        );

                        currentOpenRouterKeyIndex =
                            (currentOpenRouterKeyIndex + 1) %
                            OPENROUTER_API_KEYS.length;

                        continue;
                    }

                    const API_URL =
                        'https://openrouter.ai/api/v1/chat/completions';

                    const body =
                        JSON.stringify({
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
                        });

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
                                    body
                                }
                            );

                        if (response.ok) {
                            const data =
                                await response.json();

                            aiResponseText =
                                data.choices[0]
                                    .message.content;

                            console.log(
                                `Sucesso com a Chave OpenRouter #${currentOpenRouterKeyIndex + 1}.`
                            );

                            break;
                        }

                        const errorData =
                            await response.json();

                        const errorMessage =
                            errorData.error?.message ||
                            `Erro ${response.status}`;

                        console.warn(
                            `Chave OpenRouter #${currentOpenRouterKeyIndex + 1} falhou: ${errorMessage}. Tentando a próxima...`
                        );

                        lastAiResponse =
                            `Falha na Chave OpenRouter #${currentOpenRouterKeyIndex + 1}: ${errorMessage}`;

                    } catch (error) {
                        console.warn(
                            `Erro na requisição com a Chave OpenRouter #${currentOpenRouterKeyIndex + 1}: ${error.message}. Tentando a próxima...`
                        );

                        lastAiResponse =
                            `Falha na Chave OpenRouter #${currentOpenRouterKeyIndex + 1}: ${error.message}`;
                    }

                    currentOpenRouterKeyIndex =
                        (currentOpenRouterKeyIndex + 1) %
                        OPENROUTER_API_KEYS.length;

                    if (
                        i ===
                        OPENROUTER_API_KEYS.length - 1
                    ) {
                        deepseekKeyFailed = true;
                    }
                }

                if (
                    !aiResponseText &&
                    deepseekKeyFailed
                ) {
                    throw new Error(
                        "Todas as chaves de API do OpenRouter falharam."
                    );
                }
            }

            console.log(
                "Resposta bruta da IA:",
                aiResponseText
            );

            lastAiResponse =
                aiResponseText;

            return aiResponseText;

        } catch (error) {
            console.error(
                `Falha ao obter resposta da IA (${currentAiProvider}):`,
                error.message
            );

            lastAiResponse =
                `Erro: ${error.message}`;

            throw error;
        }
    }
        async function performAction(
        aiAnswerText,
        quizData
    ) {
        // v51: somente apresenta a resposta.
        // Nenhuma alternativa é clicada automaticamente.
        const answer =
            String(
                aiAnswerText ?? ''
            ).trim();

        lastAiResponse = answer;

        mostrarResultadoIA(
            answer,
            quizData?.questionType || 'questão'
        );

        setCursorState('success');

        return answer;
    }

    async function resolverQuestao() {
        if (window.__nikolasResolverBusy) {
            return;
        }

        window.__nikolasResolverBusy = true;

        setCursorState('processing');

        try {
            const quizData =
                await extrairDadosDaQuestao();

            if (!quizData) {
                throw new Error(
                    "Não foi possível extrair os dados da questão."
                );
            }

            let aiAnswer = null;

            if (
                quizData.questionType ===
                'dropdown'
            ) {
                console.log(
                    "Iniciando fluxo otimizado para Dropdown..."
                );

                quizData.dropdownButton?.click();

                try {
                    const optionElements =
                        await waitForElement(
                            '.v-popper__popper--shown button.dropdown-option',
                            true
                        );

                    quizData.options =
                        Array.from(
                            optionElements
                        ).map(el => ({
                            text:
                                el.innerText.trim()
                        }));

                    aiAnswer =
                        await obterRespostaDaIA(
                            quizData
                        );

                    if (
                        document.querySelector(
                            '.v-popper__popper--shown'
                        )
                    ) {
                        document.body.click();
                    }

                } catch (error) {
                    if (
                        document.querySelector(
                            '.v-popper__popper--shown'
                        )
                    ) {
                        document.body.click();
                    }

                    throw error;
                }

                if (aiAnswer) {
                    mostrarResultadoIA(
                        aiAnswer,
                        quizData.questionType
                    );

                    setCursorState('success');
                }

            } else {
                const isMath =
                    quizData.options &&
                    quizData.options.length > 0 &&
                    (
                        quizData.options[0].text.includes('\\') ||
                        quizData.questionText
                            .toLowerCase()
                            .includes('value of')
                    );

                const matchValue =
                    quizData.questionText.match(
                        /value of ([\d.]+)/i
                    );

                if (
                    isMath &&
                    matchValue
                ) {
                    const targetValue =
                        parseFloat(
                            matchValue[1]
                        );

                    const matchingOption =
                        quizData.options.find(
                            option => {
                                const computableExpr =
                                    (() => {
                                        let c =
                                            option.text
                                                .replace(
                                                    /\\left/g,
                                                    ''
                                                )
                                                .replace(
                                                    /\\right/g,
                                                    ''
                                                )
                                                .replace(
                                                    /\\div/g,
                                                    '/'
                                                )
                                                .replace(
                                                    /\\times/g,
                                                    '*'
                                                )
                                                .replace(
                                                    /\\ /g,
                                                    ''
                                                )
                                                .replace(
                                                    /(\d+)\s*\(/g,
                                                    '$1 * ('
                                                )
                                                .replace(
                                                    /\)\s*(\d+)/g,
                                                    ') * $1'
                                                );

                                        c =
                                            c.replace(
                                                /(\d+)\\frac\{(\d+)\}\{(\d+)\}/g,
                                                '($1+$2/$3)'
                                            );

                                        c =
                                            c.replace(
                                                /\\frac\{(\d+)\}\{(\d+)\}/g,
                                                '($1/$2)'
                                            );

                                        return c;
                                    })();

                                const result =
                                    (() => {
                                        try {
                                            return new Function(
                                                'return ' +
                                                computableExpr
                                            )();
                                        } catch (e) {
                                            return null;
                                        }
                                    })();

                                return (
                                    result !== null &&
                                    Math.abs(
                                        result -
                                        targetValue
                                    ) < 0.001
                                );
                            }
                        );

                    aiAnswer =
                        matchingOption
                            ? matchingOption.text
                            : null;

                    if (aiAnswer) {
                        lastAiResponse =
                            aiAnswer;

                        mostrarResultadoIA(
                            aiAnswer,
                            quizData.questionType
                        );

                        setCursorState(
                            'success'
                        );

                    } else {
                        throw new Error(
                            "Não foi possível determinar a resposta localmente."
                        );
                    }

                } else {
                    console.log(
                        "Usando IA para resolver..."
                    );

                    aiAnswer =
                        await obterRespostaDaIA(
                            quizData
                        );

                    if (aiAnswer) {
                        await performAction(
                            aiAnswer,
                            quizData
                        );
                    } else {
                        throw new Error(
                            "A IA não retornou uma resposta."
                        );
                    }
                }
            }

        } catch (error) {
            console.error(
                "Um erro ocorreu no fluxo principal:",
                error
            );

            mostrarErroDiscreto(
                error?.message ||
                "Falha ao processar a questão."
            );

            setCursorState('error');

            setTimeout(() => {
                setCursorState('normal');
            }, 1500);

        } finally {
            window.__nikolasResolverBusy =
                false;

            setTimeout(() => {
                if (
                    document.body.dataset
                        .nikolasCursorState !==
                    'error'
                ) {
                    setCursorState(
                        'normal'
                    );
                }
            }, 1800);
        }
    }

    const CURSOR_SVGS = {

        normal: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <path fill="white" stroke="black" stroke-width="1.5" d="M5 2l20 16-9 1 5 8-4 2-5-9-6 7z"/>
        </svg>`,

        processing: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="11" fill="#111" stroke="#00e5ff" stroke-width="2.5"/>
            <circle cx="16" cy="16" r="5" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-dasharray="8 5"/>
        </svg>`,

        success: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="12" fill="#071b12" stroke="#00ff9d" stroke-width="2.5"/>
            <path d="M9 16l4 4 10-10" fill="none" stroke="#00ff9d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,

        error: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="12" fill="#21090b" stroke="#ff3b4f" stroke-width="2.5"/>
            <path d="M11 11l10 10M21 11L11 21" fill="none" stroke="#ff3b4f" stroke-width="3" stroke-linecap="round"/>
        </svg>`
    };

    function svgCursor(svg) {
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, auto`;
    }

    function setCursorState(state) {
        const valid = [
            'normal',
            'processing',
            'success',
            'error'
        ];

        if (!valid.includes(state)) {
            state = 'normal';
        }

        document.body.dataset
            .nikolasCursorState = state;

        document.documentElement.style.cursor =
            svgCursor(
                CURSOR_SVGS[state]
            );

        let style =
            document.getElementById(
                'nikolas-cursor-style'
            );

        if (!style) {
            style =
                document.createElement(
                    'style'
                );

            style.id =
                'nikolas-cursor-style';

            document.head.appendChild(
                style
            );
        }

        style.textContent = `
            html.nikolas-cursor-active *,
            body.nikolas-cursor-active * {
                cursor: ${svgCursor(
                    CURSOR_SVGS[state]
                )} !important;
            }
        `;

        document.documentElement
            .classList.add(
                'nikolas-cursor-active'
            );

        document.body.classList.add(
            'nikolas-cursor-active'
        );

        if (state === 'normal') {
            setTimeout(() => {
                document.documentElement
                    .classList.remove(
                        'nikolas-cursor-active'
                    );

                document.body
                    .classList.remove(
                        'nikolas-cursor-active'
                    );

                document.documentElement
                    .style.cursor = '';

            }, 50);
        }
    }

    function mostrarResultadoIA(
        answer,
        questionType
    ) {
        let toast =
            document.getElementById(
                'nikolas-ai-result'
            );

        if (toast) {
            toast.remove();
        }

        toast =
            document.createElement(
                'div'
            );

        toast.id =
            'nikolas-ai-result';

        const safeAnswer =
            String(
                answer ||
                'Sem resposta'
            ).trim();

        toast.innerHTML = `
            <div style="font-size:11px;opacity:.65;margin-bottom:5px;">
                GEMINI • ${questionType}
            </div>

            <div style="font-size:16px;font-weight:700;line-height:1.35;word-break:break-word;"></div>
        `;

        toast.querySelector(
            'div:last-child'
        ).textContent =
            safeAnswer;

        Object.assign(
            toast.style,
            {
                position: 'fixed',
                left: '50%',
                bottom: '24px',
                transform:
                    'translateX(-50%)',
                zIndex:
                    '2147483647',
                maxWidth:
                    'min(720px, 90vw)',
                padding:
                    '12px 18px',
                borderRadius:
                    '12px',
                background:
                    'rgba(8, 12, 18, .94)',
                color: '#fff',
                border:
                    '1px solid rgba(0,229,255,.55)',
                boxShadow:
                    '0 0 22px rgba(0,229,255,.25)',
                fontFamily:
                    'system-ui, sans-serif',
                textAlign:
                    'center',
                pointerEvents:
                    'none',
                opacity: '0',
                transition:
                    'opacity .15s ease, transform .15s ease'
            }
        );

        document.body.appendChild(
            toast
        );

        requestAnimationFrame(() => {
            toast.style.opacity =
                '1';

            toast.style.transform =
                'translateX(-50%) translateY(-3px)';
        });

        clearTimeout(
            window.__nikolasResultTimer
        );

        window.__nikolasResultTimer =
            setTimeout(() => {
                toast.style.opacity =
                    '0';

                toast.style.transform =
                    'translateX(-50%) translateY(3px)';

                setTimeout(
                    () => toast.remove(),
                    180
                );

            }, 5000);
    }

    function mostrarErroDiscreto(
        message
    ) {
        let toast =
            document.getElementById(
                'nikolas-ai-error'
            );

        if (toast) {
            toast.remove();
        }

        toast =
            document.createElement(
                'div'
            );

        toast.id =
            'nikolas-ai-error';

        toast.textContent =
            `Falha: ${message}`;

        Object.assign(
            toast.style,
            {
                position: 'fixed',
                left: '50%',
                bottom: '24px',
                transform:
                    'translateX(-50%)',
                zIndex:
                    '2147483647',
                maxWidth:
                    '90vw',
                padding:
                    '10px 15px',
                borderRadius:
                    '10px',
                background:
                    'rgba(30, 7, 10, .94)',
                color: '#fff',
                border:
                    '1px solid rgba(255,59,79,.6)',
                boxShadow:
                    '0 0 20px rgba(255,59,79,.2)',
                fontFamily:
                    'system-ui, sans-serif',
                fontSize:
                    '13px',
                textAlign:
                    'center',
                pointerEvents:
                    'none'
            }
        );

        document.body.appendChild(
            toast
        );

        setTimeout(
            () => toast.remove(),
            2500
        );
    }

    let spaceListenerInstalled =
        false;

    function instalarAtalhoSpace() {
        if (
            spaceListenerInstalled
        ) {
            return;
        }

        spaceListenerInstalled =
            true;

        window.addEventListener(
            'keydown',
            (event) => {

                if (
                    event.code !==
                    'Space' ||
                    event.repeat
                ) {
                    return;
                }

                const tag =
                    document.activeElement
                        ?.tagName;

                const typing =
                    tag === 'INPUT' ||
                    tag === 'TEXTAREA' ||
                    tag === 'SELECT' ||
                    document.activeElement
                        ?.isContentEditable;

                if (typing) {
                    return;
                }

                event.preventDefault();

                resolverQuestao();
            },
            true
        );

        console.log(
            '[Nikolas Quizizz v51] Atalho Space instalado.'
        );
    }

    instalarAtalhoSpace();

    setCursorState(
        'normal'
    );

    initQuizIdDetector();

    function logQuizId(
        id,
        source
    ) {
        if (
            id ===
            quizIdDetected
        ) {
            return;
        }

        quizIdDetected =
            id;

        console.log(
            `[Quizizz Bypass] Novo Quiz ID detectado (${source}): %c${id}`,
            "color: #00FF00; font-weight: bold;"
        );
    }

    function detectQuizIdFromURL() {
        const match =
            window.location.pathname.match(
                regexQuizId
            );

        return match
            ? match[1]
            : null;
    }
        function interceptFetch() {
        const originalFetch =
            window.fetch;

        window.fetch =
            async function (...args) {

                const [resource] =
                    args;

                if (
                    typeof resource ===
                    'string'
                ) {
                    const match =
                        resource.match(
                            regexQuizId
                        );

                    if (match) {
                        const id =
                            match[1];

                        logQuizId(
                            id,
                            "fetch"
                        );
                    }
                }

                return originalFetch.apply(
                    this,
                    args
                );
            };
    }

    function interceptXHR() {
        const originalOpen =
            XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open =
            function (
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
                        const id =
                            match[1];

                        logQuizId(
                            id,
                            "XHR"
                        );
                    }
                }

                return originalOpen.apply(
                    this,
                    arguments
                );
            };
    }

    function initQuizIdDetector() {
        console.log(
            "[Quizizz Bypass] Detector de Quiz ID carregado."
        );

        const id =
            detectQuizIdFromURL();

        if (id) {
            logQuizId(
                id,
                "URL"
            );
        }

        if (
            !interceptorsStarted
        ) {
            console.log(
                "[Quizizz Bypass] Iniciando interceptadores de rede (fetch/XHR)."
            );

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

        window.addEventListener(
            "popstate",
            () =>
                setTimeout(
                    initQuizIdDetector,
                    300
                )
        );
    })();

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
            const response =
                await fetch(
                    resource,
                    {
                        ...options,
                        signal:
                            controller.signal
                    }
                );

            clearTimeout(id);

            return response;

        } catch (error) {
            clearTimeout(id);

            if (
                error.name ===
                'AbortError'
            ) {
                throw new Error(
                    'A requisição demorou muito e foi cancelada (Timeout).'
                );
            }

            throw error;
        }
    }

    async function imageUrlToBase64(
        url
    ) {
        try {
            const cacheBustUrl =
                new URL(url);

            cacheBustUrl.searchParams.set(
                '_t',
                new Date().getTime()
            );

            const r =
                await fetchWithTimeout(
                    cacheBustUrl.href,
                    {
                        cache:
                            'no-store'
                    }
                );

            if (!r.ok) {
                throw new Error(
                    `HTTP ${r.status}`
                );
            }

            const b =
                await r.blob();

            return new Promise(
                (res, rej) => {

                    const reader =
                        new FileReader();

                    reader.onloadend =
                        () =>
                            res(
                                reader.result
                            );

                    reader.onerror =
                        (e) => {
                            console.error(
                                "Erro no FileReader:",
                                e
                            );

                            rej(e);
                        };

                    reader.readAsDataURL(
                        b
                    );
                }
            );

        } catch (e) {
            console.error(
                `Erro ao converter imagem: ${e.message}`,
                url
            );

            return null;
        }
    }

    async function mostrarAvisoDeepSeekImagem() {
        return new Promise(
            resolve => {

                const old =
                    document.getElementById(
                        'nikolas-deepseek-image-warning'
                    );

                if (old) {
                    old.remove();
                }

                const overlay =
                    document.createElement(
                        'div'
                    );

                overlay.id =
                    'nikolas-deepseek-image-warning';

                Object.assign(
                    overlay.style,
                    {
                        position:
                            'fixed',
                        inset:
                            '0',
                        display:
                            'flex',
                        alignItems:
                            'center',
                        justifyContent:
                            'center',
                        zIndex:
                            '2147483647',
                        background:
                            'rgba(0,0,0,.55)',
                        fontFamily:
                            'system-ui, sans-serif'
                    }
                );

                const box =
                    document.createElement(
                        'div'
                    );

                Object.assign(
                    box.style,
                    {
                        width:
                            'min(420px, 90vw)',
                        padding:
                            '20px',
                        borderRadius:
                            '14px',
                        background:
                            '#0b1118',
                        color:
                            '#fff',
                        border:
                            '1px solid rgba(0,229,255,.45)',
                        boxShadow:
                            '0 0 30px rgba(0,229,255,.18)',
                        textAlign:
                            'center'
                    }
                );

                const title =
                    document.createElement(
                        'div'
                    );

                title.textContent =
                    'A questão possui imagem';

                title.style.fontSize =
                    '18px';

                title.style.fontWeight =
                    '700';

                title.style.marginBottom =
                    '8px';

                const text =
                    document.createElement(
                        'div'
                    );

                text.textContent =
                    'O DeepSeek não consegue analisar imagens. Escolha como continuar.';

                text.style.fontSize =
                    '13px';

                text.style.opacity =
                    '.75';

                text.style.marginBottom =
                    '16px';

                const buttons =
                    document.createElement(
                        'div'
                    );

                Object.assign(
                    buttons.style,
                    {
                        display:
                            'flex',
                        gap:
                            '10px',
                        justifyContent:
                            'center',
                        flexWrap:
                            'wrap'
                    }
                );

                const geminiBtn =
                    document.createElement(
                        'button'
                    );

                geminiBtn.textContent =
                    'Usar Gemini';

                const noImageBtn =
                    document.createElement(
                        'button'
                    );

                noImageBtn.textContent =
                    'Continuar sem imagem';

                [
                    geminiBtn,
                    noImageBtn
                ].forEach(
                    button => {
                        Object.assign(
                            button.style,
                            {
                                padding:
                                    '9px 14px',
                                borderRadius:
                                    '9px',
                                border:
                                    '1px solid rgba(255,255,255,.15)',
                                background:
                                    '#16202b',
                                color:
                                    '#fff',
                                cursor:
                                    'pointer',
                                fontWeight:
                                    '600'
                            }
                        );
                    }
                );

                geminiBtn.onclick =
                    () => {
                        overlay.remove();
                        resolve(
                            'gemini'
                        );
                    };

                noImageBtn.onclick =
                    () => {
                        overlay.remove();
                        resolve(
                            'sem_imagem'
                        );
                    };

                buttons.appendChild(
                    geminiBtn
                );

                buttons.appendChild(
                    noImageBtn
                );

                box.appendChild(
                    title
                );

                box.appendChild(
                    text
                );

                box.appendChild(
                    buttons
                );

                overlay.appendChild(
                    box
                );

                document.body.appendChild(
                    overlay
                );
            }
        );
    }

})();
