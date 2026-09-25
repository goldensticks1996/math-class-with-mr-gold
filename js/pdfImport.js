// === PDF IMPORTER (rebuilt) ===
//
// What this does, in plain terms:
//   1. Reads all text out of the PDF, keeping track of which page and
//      vertical position every piece of text came from.
//   2. Finds where each question starts (supports "Question 1", "Q1",
//      or a plain "1." at the start of a line if no Question/Q markers
//      exist anywhere in the file).
//   3. Splits each question into its text, its lettered options (A-E),
//      and its marked correct answer (supports "Correct Option: A",
//      "Answer: A", "Ans: A", "Correct Answer: A").
//   4. Extracts every embedded picture in the PDF (any bitmap image,
//      regardless of how the PDF was produced).
//   5. Matches each picture to the question whose text-span it falls
//      inside, on the same page. If a picture can't be confidently
//      matched to exactly one question, it is left for the teacher to
//      attach manually - never guessed.
//   6. Shows a clean review list (no raw numbers/operator dumps) where
//      the teacher checks everything, fixes anything flagged, attaches
//      any leftover images, then saves it all to the Question Bank in
//      one go.
//
// Nothing here saves silently - the teacher always sees a review step
// before anything reaches the database.

let importReviewState = {
    questions: [],   // { text, options[5], correctLetter, image, flags[], page, yStart }
    leftoverImages: [] // { id, dataUrl, page }
};

async function processPDF() {
    const fileInput = document.getElementById('pdf-file-input');
    const summaryBox = document.getElementById('pdf-summary-box');
    const reviewList = document.getElementById('pdf-review-list');
    const saveBtn = document.getElementById('pdf-save-all-btn');

    reviewList.innerHTML = "";
    saveBtn.classList.add('hidden');
    summaryBox.classList.remove('hidden');
    summaryBox.innerHTML = "Reading your PDF...";

    const file = fileInput.files[0];
    if (!file) {
        summaryBox.innerHTML = "Please choose a PDF file first.";
        return;
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        summaryBox.innerHTML = `Found ${pdf.numPages} page(s). Reading questions and pictures...`;

        const { fullText, positions, images } = await extractPdfContent(pdf);
        const questions = detectQuestions(fullText, positions);

        if (questions.length === 0) {
            summaryBox.innerHTML = `Couldn't detect any questions in this PDF. Make sure questions are numbered ` +
                `("Question 1", "Q1", or "1.") and options are lettered (a. b. c. d. e.). See the PDF template guide for the exact format.`;
            return;
        }

        const { matchedCount, leftoverImages } = matchImagesToQuestions(questions, images);
        importReviewState.questions = questions;
        importReviewState.leftoverImages = leftoverImages;

        const needsReviewCount = questions.filter(q => q.flags.length > 0).length;
        summaryBox.innerHTML =
            `<strong>${questions.length} question(s)</strong> detected across ${pdf.numPages} page(s). ` +
            `<strong>${images.length} picture(s)</strong> found, <strong>${matchedCount} auto-matched</strong>` +
            (leftoverImages.length > 0 ? `, <strong>${leftoverImages.length} left for you to place</strong>` : '') + `. ` +
            (needsReviewCount > 0
                ? `<span style="color:#8a5a00;">${needsReviewCount} question(s) need a quick check below before saving.</span>`
                : `Everything looks good - review below, then save.`);

        renderImportReview();
        saveBtn.classList.remove('hidden');

    } catch (err) {
        summaryBox.innerHTML = `Couldn't read this PDF (${err.message || 'unknown error'}). ` +
            `Try re-saving/exporting it and uploading again, or check it against the PDF template guide.`;
    }
}

// --- STEP 1: pull text (with position) and every bitmap image out of the PDF ---
async function extractPdfContent(pdf) {
    let fullText = "";
    const positions = []; // { offset, page, y }
    const images = [];    // { page, y, height, dataUrl }

    const opsMap = {};
    if (pdfjsLib.OPS) {
        Object.keys(pdfjsLib.OPS).forEach(key => { opsMap[pdfjsLib.OPS[key]] = key; });
    }
    const bitmapOpNames = ['paintImageXObject', 'paintInlineImageXObject'];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });

        // --- text, reconstructed with real line breaks based on vertical position ---
        const textContent = await page.getTextContent();
        let lastY = null;
        textContent.items.forEach(item => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const y = Math.round((viewport.height - tx[5]) * 100) / 100;
            if (lastY !== null && Math.abs(y - lastY) > 3) {
                fullText += "\n";
            } else if (fullText.length > 0 && !fullText.endsWith("\n") && !fullText.endsWith(" ")) {
                fullText += " ";
            }
            positions.push({ offset: fullText.length, page: pageNum, y });
            fullText += item.str;
            lastY = y;
        });
        fullText += "\n";

        // --- every embedded bitmap image on this page ---
        const opList = await page.getOperatorList();
        let currentTransform = [1, 0, 0, 1, 0, 0];
        for (let i = 0; i < opList.fnArray.length; i++) {
            const opName = opsMap[opList.fnArray[i]] || '';
            const args = opList.argsArray[i];
            if (opName === 'transform') currentTransform = args;
            if (bitmapOpNames.includes(opName)) {
                const imgObjId = (args && args.length > 0) ? args[0] : null;
                const pdfHeight = Math.abs(currentTransform[3]);
                const posY = viewport.height - currentTransform[5] - pdfHeight;
                let dataUrl = null;
                try {
                    let imgObj = null;
                    if (page.objs?.has?.(imgObjId)) imgObj = page.objs.get(imgObjId);
                    else if (page.commonObjs?.has?.(imgObjId)) imgObj = page.commonObjs.get(imgObjId);
                    if (imgObj && imgObj.width && imgObj.height) {
                        dataUrl = renderImageObjectToDataUrl(imgObj);
                    }
                } catch (e) { /* skip images we genuinely can't decode */ }

                if (dataUrl) {
                    images.push({ page: pageNum, y: Math.round(posY * 100) / 100, height: Math.round(pdfHeight * 100) / 100, dataUrl });
                }
            }
        }
    }

    return { fullText, positions, images };
}

function renderImageObjectToDataUrl(imgObj) {
    const canvas = document.createElement('canvas');
    canvas.width = imgObj.width;
    canvas.height = imgObj.height;
    const ctx = canvas.getContext('2d');

    if (imgObj.data) {
        const numPixels = imgObj.width * imgObj.height;
        const imgData = ctx.createImageData(imgObj.width, imgObj.height);
        const src = imgObj.data;
        if (src.length === numPixels * 4) {
            imgData.data.set(src);
        } else if (src.length === numPixels * 3) {
            let d = 0;
            for (let s = 0; s < src.length; s += 3) {
                imgData.data[d] = src[s]; imgData.data[d + 1] = src[s + 1]; imgData.data[d + 2] = src[s + 2]; imgData.data[d + 3] = 255;
                d += 4;
            }
        } else if (src.length === numPixels) {
            let d = 0;
            for (let s = 0; s < src.length; s++) {
                const g = src[s];
                imgData.data[d] = g; imgData.data[d + 1] = g; imgData.data[d + 2] = g; imgData.data[d + 3] = 255;
                d += 4;
            }
        } else {
            return null;
        }
        ctx.putImageData(imgData, 0, 0);
    } else if (imgObj.bitmap) {
        ctx.drawImage(imgObj.bitmap, 0, 0);
    } else {
        return null;
    }
    return canvas.toDataURL('image/png');
}

// --- STEP 2: find question boundaries + parse each one ---
function locatePosition(positions, offset) {
    // last position whose offset <= given offset
    let lo = 0, hi = positions.length - 1, result = positions[0] || { page: 1, y: 0 };
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (positions[mid].offset <= offset) { result = positions[mid]; lo = mid + 1; }
        else hi = mid - 1;
    }
    return result;
}

function detectQuestions(fullText, positions) {
    const headerRegexPrimary = /(?:Question\s*(\d{1,3})|Q(\d{1,3}))[:.\)]?\s+/gi;
    let matches = [];
    let m;
    while ((m = headerRegexPrimary.exec(fullText)) !== null) {
        matches.push({ index: m.index, headerLength: m[0].length, number: parseInt(m[1] || m[2], 10) });
    }

    // Fallback: plain numbered lines ("1.", "2)") - only used when the document
    // has no explicit Question/Q markers at all, to avoid false positives from
    // ordinary numbers in math content.
    if (matches.length < 2) {
        matches = [];
        const headerRegexFallback = /\n\s*(\d{1,3})[\.\)]\s+/g;
        while ((m = headerRegexFallback.exec(fullText)) !== null) {
            matches.push({ index: m.index + m[0].indexOf(m[1]), headerLength: m[0].length - m[0].indexOf(m[1]), number: parseInt(m[1], 10) });
        }
    }

    if (matches.length === 0) return [];

    const questions = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i].headerLength;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : fullText.length;
        const block = fullText.slice(start, end);

        const startPos = locatePosition(positions, start);
        const endPos = locatePosition(positions, end);

        const parsed = parseQuestionBlock(block);
        questions.push({
            number: matches[i].number,
            text: parsed.text,
            options: parsed.options,
            correctLetter: parsed.correctLetter,
            flags: parsed.flags,
            image: null,
            page: startPos.page,
            yStart: startPos.y,
            endPage: endPos.page,
            endY: endPos.y
        });
    }
    return questions;
}

function parseQuestionBlock(block) {
    const flags = [];

    // Find the answer key first, anywhere in the block, and cut it out so it
    // never leaks into the question text or the last option.
    const answerRegex = /(?:Correct\s*(?:Option|Answer)|Answer|Ans)\s*[:\-]?\s*([A-E])\b/i;
    const answerMatch = block.match(answerRegex);
    let correctLetter = null;
    let workingBlock = block;
    if (answerMatch) {
        correctLetter = answerMatch[1].toUpperCase();
        workingBlock = block.slice(0, answerMatch.index) + block.slice(answerMatch.index + answerMatch[0].length);
    } else {
        flags.push('No correct answer detected - please set it manually.');
    }

    // Option markers: a letter A-E followed by "." or ")" then whitespace,
    // itself preceded by whitespace/line-start (keeps it from matching things
    // like decimals inside the question text).
    const optionRegex = /(?:^|\n|\s)([A-Ea-e])[\.\)]\s+/g;
    const optionMatches = [];
    let om;
    while ((om = optionRegex.exec(workingBlock)) !== null) {
        optionMatches.push({ index: om.index + om[0].indexOf(om[1]), headerLength: om[0].length - om[0].indexOf(om[1]), letter: om[1].toUpperCase() });
    }

    let questionText, options;
    if (optionMatches.length >= 2) {
        questionText = workingBlock.slice(0, optionMatches[0].index).replace(/\s+/g, ' ').trim();
        options = [];
        for (let i = 0; i < optionMatches.length; i++) {
            const s = optionMatches[i].index + optionMatches[i].headerLength;
            const e = (i + 1 < optionMatches.length) ? optionMatches[i + 1].index : workingBlock.length;
            options.push(workingBlock.slice(s, e).replace(/\s+/g, ' ').trim());
        }
    } else {
        questionText = workingBlock.replace(/\s+/g, ' ').trim();
        options = [];
        flags.push('Could not detect lettered options (a. b. c. d. e.) - please fill these in manually.');
    }

    if (options.length > 5) options = options.slice(0, 5);
    while (options.length < 5) {
        options.push('');
        if (!flags.includes('Fewer than 5 options were detected - please complete the missing option(s).')) {
            flags.push('Fewer than 5 options were detected - please complete the missing option(s).');
        }
    }

    if (!questionText) flags.push('Question text looks empty - please check it.');

    return { text: questionText, options, correctLetter, flags };
}

// --- STEP 3: match each image to the one question whose span contains it ---
function matchImagesToQuestions(questions, images) {
    let matchedCount = 0;
    const leftoverImages = [];

    images.forEach((img, idx) => {
        const imgCenter = img.y + img.height / 2;

        // A question "covers" this image if the image's page/position falls
        // between the question's start and the next question's start.
        const candidates = questions.filter(q => {
            if (img.page < q.page || img.page > q.endPage) return false;
            if (img.page === q.page && img.page === q.endPage) {
                return imgCenter >= q.yStart && imgCenter < q.endY;
            }
            if (img.page === q.page) return imgCenter >= q.yStart;   // image on the question's start page, below its header
            if (img.page === q.endPage) return imgCenter < q.endY;   // image on the page the next question starts
            return true; // image on a page fully between start and end pages
        });

        if (candidates.length === 1 && !candidates[0].image) {
            candidates[0].image = img.dataUrl;
            matchedCount++;
        } else {
            leftoverImages.push({ id: `img_${idx}`, dataUrl: img.dataUrl, page: img.page });
        }
    });

    return { matchedCount, leftoverImages };
}

// --- STEP 4: teacher-facing review UI (no raw diagnostics) ---
function renderImportReview() {
    const container = document.getElementById('pdf-review-list');
    container.innerHTML = "";
    const letters = ['A', 'B', 'C', 'D', 'E'];

    importReviewState.questions.forEach((q, qIdx) => {
        const hasFlags = q.flags.length > 0;
        const card = document.createElement('div');
        card.className = 'review-card' + (hasFlags ? ' needs-image' : '');

        const imageBlock = q.image
            ? `<div class="q-diagram-container"><img class="q-diagram-img" src="${q.image}">
                 <br><button class="btn-danger" style="width:auto;margin-top:6px;" onclick="reviewRemoveImage(${qIdx})">Remove Image</button></div>`
            : (importReviewState.leftoverImages.length > 0
                ? `<div style="margin-top:8px;">
                     <label>No image auto-matched - attach one if this question needs one:</label>
                     <select id="review-img-select-${qIdx}">
                        <option value="">-- none --</option>
                        ${importReviewState.leftoverImages.map(li => `<option value="${li.id}">Picture from page ${li.page}</option>`).join('')}
                     </select>
                     <button class="btn-gold" style="width:auto;margin-top:6px;" onclick="reviewAttachImage(${qIdx})">Attach</button>
                   </div>`
                : '');

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:normal;">
                    <input type="checkbox" id="review-include-${qIdx}" style="width:auto;" ${hasFlags ? '' : 'checked'}>
                    <span class="qb-q-title">Q${q.number}: ${q.text || '(empty)'}</span>
                </label>
                ${hasFlags ? `<span class="review-flag">NEEDS REVIEW</span>` : ''}
            </div>
            ${hasFlags ? `<ul style="margin:8px 0 0 20px;color:#8a5a00;font-size:13px;">${q.flags.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
            ${imageBlock}
            <div style="margin-top:10px;">
                ${letters.map((l, i) => `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
                        <input type="radio" name="review-correct-${qIdx}" value="${l}" ${q.correctLetter === l ? 'checked' : ''} style="width:auto;">
                        <input type="text" id="review-opt-${qIdx}-${i}" value="${(q.options[i] || '').replace(/"/g, '&quot;')}" placeholder="Option ${l}" style="flex:1;">
                    </div>`).join('')}
            </div>
        `;
        container.appendChild(card);
    });
}

function reviewRemoveImage(qIdx) {
    importReviewState.questions[qIdx].image = null;
    renderImportReview();
}

function reviewAttachImage(qIdx) {
    const select = document.getElementById(`review-img-select-${qIdx}`);
    const chosenId = select.value;
    if (!chosenId) return;
    const img = importReviewState.leftoverImages.find(li => li.id === chosenId);
    if (img) {
        importReviewState.questions[qIdx].image = img.dataUrl;
        renderImportReview();
    }
}

// --- STEP 5: save everything the teacher included ---
async function saveAllImportedQuestions() {
    const msg = document.getElementById('teacher-msg');
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const rowsToSave = [];
    let skipped = 0;

    importReviewState.questions.forEach((q, qIdx) => {
        const includeBox = document.getElementById(`review-include-${qIdx}`);
        if (!includeBox || !includeBox.checked) { skipped++; return; }

        const opts = letters.map((l, i) => document.getElementById(`review-opt-${qIdx}-${i}`).value.trim());
        const correctRadio = document.querySelector(`input[name="review-correct-${qIdx}"]:checked`);

        if (opts.some(o => !o) || !correctRadio) {
            skipped++;
            return; // still incomplete - leave it unchecked/visible for the teacher rather than saving bad data
        }

        rowsToSave.push({
            teacher_id: window.APP.currentUserId,
            assessment_id: null,
            question_text: importReviewState.questions[qIdx].text || `Question ${importReviewState.questions[qIdx].number}`,
            option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3], option_e: opts[4],
            correct_answer: correctRadio.value,
            question_number: 0, // set below once we know the starting number
            image: importReviewState.questions[qIdx].image,
            source: 'pdf',
            batch_id: 'pdf_' + Date.now()
        });
    });

    if (rowsToSave.length === 0) {
        msg.innerText = "Nothing to save - either everything is unchecked, or some flagged questions still need options/answers filled in.";
        msg.style.color = "#d9534f";
        return;
    }

    try {
        const startingNumber = await nextQuestionNumber();
        rowsToSave.forEach((row, i) => { row.question_number = startingNumber + i; });

        const { error } = await window.mySupabase.from('questions').insert(rowsToSave);
        if (error) {
            msg.innerText = `Save failed: ${error.message}`;
            msg.style.color = "#d9534f";
            return;
        }

        msg.innerText = `${rowsToSave.length} question(s) saved to your Question Bank!` +
            (skipped > 0 ? ` (${skipped} left out - unchecked or still incomplete.)` : '');
        msg.style.color = "#28a745";

        document.getElementById('pdf-review-list').innerHTML = "";
        document.getElementById('pdf-summary-box').classList.add('hidden');
        document.getElementById('pdf-save-all-btn').classList.add('hidden');
        document.getElementById('pdf-file-input').value = "";
        importReviewState = { questions: [], leftoverImages: [] };
        renderQuestionBank();
    } catch (err) {
        msg.innerText = "Unable to connect to database while saving.";
        msg.style.color = "#d9534f";
    }
}
