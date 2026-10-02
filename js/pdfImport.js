const PDF_GUIDE_TEXT = `MATH CLASS WITH MR. GOLD — PDF TEMPLATE GUIDE FOR TEACHERS
============================================================

Follow this format when typing your exam in Word (or Google Docs)
before saving/exporting it as a PDF. The importer can attempt any
PDF, but questions formatted this way will be read the most
accurately — especially when they include diagrams or pictures.

------------------------------------------------------------
1. NUMBER EACH QUESTION CLEARLY
------------------------------------------------------------
Start every question on its own line with one of these:

    Question 1
    Q1

Followed by the question text. Example:

    Question 1
    What is the value of x in the equation 2x + 4 = 10?

Do not just start with a bare number like "1." if you can help
it — "Question 1" or "Q1" is far more reliable to detect.

------------------------------------------------------------
2. LETTER YOUR OPTIONS a. THROUGH e.
------------------------------------------------------------
Always provide exactly 5 options, each on its own line, starting
with the letter and a period:

    a. 2
    b. 3
    c. 4
    d. 5
    e. 6

Use lowercase or uppercase letters (a. or A.) — both work. Keep
each option on its own line rather than run together.

------------------------------------------------------------
3. MARK THE CORRECT ANSWER
------------------------------------------------------------
After the options, add one line stating the correct answer using
any of these formats:

    Correct Option: A
    Correct Answer: A
    Answer: A
    Ans: A

Put this directly after the question's options and before the
next question begins.

------------------------------------------------------------
4. ADDING A DIAGRAM OR PICTURE TO A QUESTION
------------------------------------------------------------
Insert the picture directly under the question text, before the
lettered options — using Word's normal "Insert > Picture" (not a
drawn/vector shape). This matters: the importer reads embedded
pictures, not shapes drawn directly in Word or PDF export tools.

    Question 4
    What is the area of the triangle shown below?

    [picture of the triangle]

    a. 12 cm²
    b. 24 cm²
    c. 36 cm²
    d. 48 cm²
    e. 60 cm²
    Correct Option: B

Keep exactly one picture per question, placed between that
question's text and its options. Avoid placing two pictures for
two different questions close together on the same line/area —
give each its own clear space so the importer can tell which
question it belongs to.

------------------------------------------------------------
5. A FULL WORKED EXAMPLE
------------------------------------------------------------

    Question 1
    What is 7 + 5?
    a. 10
    b. 11
    c. 12
    d. 13
    e. 14
    Correct Option: C

    Question 2
    Simplify: 3x + 2x
    a. 5
    b. x5
    c. 5x
    d. 6x
    e. 5x2
    Correct Option: C

    Question 3
    What shape is shown below?

    [picture of a hexagon]

    a. Pentagon
    b. Hexagon
    c. Octagon
    d. Square
    e. Triangle
    Correct Option: B

------------------------------------------------------------
6. UNDERLINED WORDS
------------------------------------------------------------
Use Word's normal underline (Ctrl+U) on the word or words. The
importer sees the underline and shows that word underlined for
the student, inside the question (and inside passages).

    Question 5
    Choose the word closest in meaning to the underlined word:
    Mr. Gold is a very handsome man.      (underline "handsome")
    a. ugly
    b. good-looking
    ...
    Correct Option: B

------------------------------------------------------------
7. READING PASSAGES
------------------------------------------------------------
Type the passage on its own, BEFORE the first question it
belongs to. You can write which questions it covers:

    Read the passage below and answer questions 1 to 5.
    (passage text...)

    Question 1
    ...

If the passage says "questions 1 to 5" the importer ticks Q1-Q5
for you. Otherwise it ticks from the passage to the next passage.
Either way you will be asked to confirm which questions each
passage covers before anything is saved. For passages in the
middle of the exam, put the passage after the previous question's
"Correct Option" line.

------------------------------------------------------------
8. IF SOMETHING GETS FLAGGED AFTER IMPORT
------------------------------------------------------------
After uploading, the app will show you every detected question
for review before saving anything. If a question is missing an
option, missing its answer, or a picture couldn't be confidently
matched, it will be clearly flagged — you just fill in or fix
the flagged part and pick "Save All To Question Bank." Nothing
gets saved automatically without you seeing it first.
`;

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
    originalQuestions: [], // untouched snapshot right after parsing+auto-matching, for "Reset This Question"
    leftoverImages: [], // { id, dataUrl, page }
    passages: []     // { id, text, afterIndex, include, selected:[question indexes], note }
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

        const { fullText, positions, images, underlined } = await extractPdfContent(pdf);
        const { questions, passageCandidates } = detectQuestions(fullText, positions, underlined);

        if (questions.length === 0) {
            summaryBox.innerHTML = `Couldn't detect any questions in this PDF. Make sure questions are numbered ` +
                `("Question 1", "Q1", or "1.") and options are lettered (a. b. c. d. e.). See the PDF template guide for the exact format.`;
            return;
        }

        const { matchedCount, leftoverImages } = matchImagesToQuestions(questions, images);
        importReviewState.questions = questions;
        importReviewState.originalQuestions = JSON.parse(JSON.stringify(questions));
        importReviewState.leftoverImages = leftoverImages;
        importReviewState.passages = buildPassageList(questions, passageCandidates);

        const needsReviewCount = questions.filter(q => q.flags.length > 0).length;
        summaryBox.innerHTML =
            `<strong>${questions.length} question(s)</strong> detected across ${pdf.numPages} page(s). ` +
            `<strong>${images.length} picture(s)</strong> found, <strong>${matchedCount} auto-matched</strong>` +
            (leftoverImages.length > 0 ? `, <strong>${leftoverImages.length} left for you to place</strong>` : '') + `. ` +
            (underlined.size > 0 ? `<strong>Underlined words</strong> were found and are marked below. ` : '') +
            (importReviewState.passages.length > 0
                ? `<strong>${importReviewState.passages.length} reading passage(s)</strong> detected - check which questions each one covers. `
                : '') +
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
    const underlined = new Set(); // fullText character offsets that are underlined in the PDF
    const images = [];    // { page, y, height, dataUrl }

    const opsMap = {};
    if (pdfjsLib.OPS) {
        Object.keys(pdfjsLib.OPS).forEach(key => { opsMap[pdfjsLib.OPS[key]] = key; });
    }
    const bitmapOpNames = ['paintImageXObject', 'paintInlineImageXObject'];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const opList = await page.getOperatorList();
        const ulSegments = collectUnderlineSegments(opList, viewport);

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
            if (ulSegments.length > 0 && item.str) {
                const flags = underlinedCharIndices(item.str, tx[4], (item.width || 0) * viewport.scale, Math.hypot(tx[2], tx[3]), tx[5], ulSegments);
                flags.forEach((on, i) => { if (on) underlined.add(fullText.length + i); });
            }
            fullText += item.str;
            lastY = y;
        });
        fullText += "\n";

        // --- every embedded bitmap image on this page ---
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

    return { fullText, positions, images, underlined };
}

// --- Underline detection ---
// A PDF has no "underline" attribute on text: Word/Google Docs simply draw a thin
// horizontal line (or very flat rectangle) just under the words. So we collect every
// thin horizontal line on the page, then see which words sit directly on top of one.

function collectUnderlineSegments(opList, viewport) {
    const OPS = pdfjsLib.OPS;
    const U = pdfjsLib.Util;
    const segments = [];                  // { x1, x2, y } in page coordinates, y measured down from the top
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let subpaths = [];
    let cur = null;
    const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
        OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEoFillStroke]);

    function flush(painted) {
        if (painted) {
            const m = U.transform(viewport.transform, ctm);
            subpaths.forEach(pts => {
                if (pts.length < 2) return;
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                pts.forEach(([x, y]) => {
                    const px = m[0] * x + m[2] * y + m[4];
                    const py = m[1] * x + m[3] * y + m[5];
                    if (px < minX) minX = px; if (px > maxX) maxX = px;
                    if (py < minY) minY = py; if (py > maxY) maxY = py;
                });
                if (maxY - minY <= 3 && maxX - minX >= 4) segments.push({ x1: minX, x2: maxX, y: (minY + maxY) / 2 });
            });
        }
        subpaths = [];
        cur = null;
    }

    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.transform) ctm = U.transform(ctm, args);
        else if (fn === OPS.constructPath && Array.isArray(args[0])) {
            const ops = args[0], c = args[1];
            let k = 0;
            for (const op of ops) {
                if (op === OPS.moveTo) { cur = [[c[k], c[k + 1]]]; subpaths.push(cur); k += 2; }
                else if (op === OPS.lineTo) {
                    if (!cur) { cur = [[c[k], c[k + 1]]]; subpaths.push(cur); } else cur.push([c[k], c[k + 1]]);
                    k += 2;
                }
                else if (op === OPS.rectangle) {
                    const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3];
                    subpaths.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
                    cur = null; k += 4;
                }
                else if (op === OPS.curveTo) k += 6;
                else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
            }
        }
        else if (paintOps.has(fn)) flush(true);
        else if (fn === OPS.endPath) flush(false); // a clipping path, not something drawn
    }
    return segments;
}

// For one piece of text, which of its characters sit on an underline?
// Letter widths are estimated evenly across the run, then snapped to whole words
// (underlining is always applied to words, never half a word).
function underlinedCharIndices(str, x0, width, fontSize, baselineY, segments) {
    const flags = new Array(str.length).fill(false);
    if (!str.length || !(width > 0)) return flags;

    const near = segments.filter(s =>
        s.y >= baselineY - fontSize * 0.15 && s.y <= baselineY + fontSize * 0.45 &&
        s.x2 > x0 + 0.5 && s.x1 < x0 + width - 0.5);
    if (near.length === 0) return flags;

    const cw = width / str.length;
    for (let i = 0; i < str.length; i++) {
        const cx = x0 + (i + 0.5) * cw;
        if (near.some(s => cx >= s.x1 - 1 && cx <= s.x2 + 1)) flags[i] = true;
    }

    const wordRe = /\S+/g;
    let m;
    while ((m = wordRe.exec(str)) !== null) {
        let hits = 0;
        for (let j = m.index; j < m.index + m[0].length; j++) if (flags[j]) hits++;
        const on = hits >= m[0].length * 0.5;
        for (let j = m.index; j < m.index + m[0].length; j++) flags[j] = on;
    }
    for (let i = 0; i < str.length; i++) {
        if (/\s/.test(str[i])) flags[i] = !!(flags[i - 1] && flags[i + 1]);
    }
    return flags;
}

// Turns a slice of text into clean single-spaced text, wrapping underlined words in [u]...[/u].
// `offsetOf(i)` gives the original PDF-text offset of character i, so underline flags stay correct
// even after cutting pieces (like the answer line) out of the middle.
function buildMarked(text, offsetOf, start, end, underlined) {
    let out = '', inU = false, pendingSpace = false;
    for (let i = start; i < end; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) { pendingSpace = out.length > 0; continue; }
        const u = !!(underlined && underlined.has(offsetOf(i)));
        if (pendingSpace) {
            if (inU && !u) { out += '[/u]'; inU = false; }
            out += ' ';
            pendingSpace = false;
        }
        if (u && !inU) { out += '[u]'; inU = true; }
        else if (!u && inU) { out += '[/u]'; inU = false; }
        out += ch;
    }
    if (inU) out += '[/u]';
    return out;
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

function detectQuestions(fullText, positions, underlined) {
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

    if (matches.length === 0) return { questions: [], passageCandidates: [] };

    const questions = [];
    const passageCandidates = []; // { afterIndex, text } - passage sits after question #afterIndex (-1 = before Q1)

    // Text before the first question may be a reading passage (or just instructions - the teacher decides).
    const preamble = buildMarked(fullText, i => i, 0, matches[0].index, underlined);
    if (looksLikePassage(preamble)) passageCandidates.push({ afterIndex: -1, text: preamble });

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i].headerLength;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : fullText.length;
        const block = fullText.slice(start, end);

        const startPos = locatePosition(positions, start);
        const endPos = locatePosition(positions, end);

        const parsed = parseQuestionBlock(block, start, underlined);
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
        // Long text after a question's answer line, before the next question, is a passage for what follows.
        if (parsed.tailText && i + 1 < matches.length && looksLikePassage(parsed.tailText)) {
            passageCandidates.push({ afterIndex: i, text: parsed.tailText });
        }
    }
    return { questions, passageCandidates };
}

function looksLikePassage(text) {
    const plain = (text || '').replace(/\[\/?u\]/g, '').trim();
    return plain.length >= 120 || (plain.length >= 40 && /passage/i.test(plain));
}

function parseQuestionBlock(block, blockStart, underlined) {
    const flags = [];

    // Find the answer key first, anywhere in the block, and cut it out so it
    // never leaks into the question text or the last option.
    const answerRegex = /(?:Correct\s*(?:Option|Answer)|Answer|Ans)\s*[:\-]?\s*([A-E])\b/i;
    const optionTest = /(?:^|\n|\s)([A-Ea-e])[\.\)]\s+/;
    const answerMatch = block.match(answerRegex);
    let correctLetter = null;
    let workingBlock = block;
    let offsetOf = (i) => blockStart + i;
    let tailText = null;

    if (answerMatch) {
        correctLetter = answerMatch[1].toUpperCase();
        const before = block.slice(0, answerMatch.index);
        const afterStart = answerMatch.index + answerMatch[0].length;
        const after = block.slice(afterStart);
        const afterIsPassage = !optionTest.test(after) && after.replace(/\s+/g, ' ').trim().length >= 40;
        if (afterIsPassage) {
            // Everything after the answer line is not part of this question - keep it as a possible passage.
            workingBlock = before;
            tailText = buildMarked(block, (i) => blockStart + i, afterStart, block.length, underlined);
        } else {
            workingBlock = before + after;
            offsetOf = (i) => blockStart + (i < before.length ? i : i + answerMatch[0].length);
        }
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
        questionText = buildMarked(workingBlock, offsetOf, 0, optionMatches[0].index, underlined);
        options = [];
        for (let i = 0; i < optionMatches.length; i++) {
            const s = optionMatches[i].index + optionMatches[i].headerLength;
            const e = (i + 1 < optionMatches.length) ? optionMatches[i + 1].index : workingBlock.length;
            options.push(buildMarked(workingBlock, offsetOf, s, e, underlined));
        }
    } else {
        questionText = buildMarked(workingBlock, offsetOf, 0, workingBlock.length, underlined);
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

    return { text: questionText, options, correctLetter, flags, tailText };
}

// Decide which questions each passage covers: the passage's own wording ("questions 1 to 5") wins,
// otherwise everything from the passage up to the next passage. The teacher confirms in the review step.
function buildPassageList(questions, candidates) {
    const passages = candidates
        .slice().sort((a, b) => a.afterIndex - b.afterIndex)
        .map((c, i) => ({ id: i, text: c.text, afterIndex: c.afterIndex, include: true, selected: [], note: '' }));

    passages.forEach((p, pi) => {
        const startIdx = p.afterIndex + 1;
        const next = passages[pi + 1];
        let sel = [];
        let note = '';
        const hint = /questions?\s*(\d{1,3})\s*(?:to|-|–|—|through|and|&)\s*(\d{1,3})/i.exec(p.text.replace(/\[\/?u\]/g, ''));
        if (hint) {
            const lo = Math.min(+hint[1], +hint[2]), hi = Math.max(+hint[1], +hint[2]);
            questions.forEach((q, qi) => { if (q.number >= lo && q.number <= hi) sel.push(qi); });
            if (sel.length) note = `Auto-selected Q${lo} to Q${hi}, because the passage says so.`;
        }
        if (sel.length === 0 && startIdx < questions.length) {
            if (next && next.afterIndex >= startIdx) {
                for (let qi = startIdx; qi <= next.afterIndex; qi++) sel.push(qi);
                note = `Auto-selected Q${questions[startIdx].number} to Q${questions[next.afterIndex].number} (from this passage up to the next one).`;
            } else {
                sel = [startIdx];
                note = 'Only the first question after the passage is selected - please tick every question it covers.';
            }
        }
        p.selected = sel;
        p.note = note;
    });
    return passages;
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

    renderPassageReview(container);

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

        const uploadBlock = `
            <div style="margin-top:8px;">
                <label style="font-size:12px;">Or upload the correct image from your computer:</label>
                <input type="file" accept="image/png, image/jpeg, image/webp" onchange="reviewUploadImage(event, ${qIdx})">
            </div>`;

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:normal;">
                    <input type="checkbox" id="review-include-${qIdx}" style="width:auto;" ${hasFlags ? '' : 'checked'}>
                    <span class="qb-q-title">Q${q.number}: ${q.text ? formatQText(q.text) : '(empty)'}</span>
                </label>
                ${hasFlags ? `<span class="review-flag">NEEDS REVIEW</span>` : ''}
            </div>
            ${hasFlags ? `<ul style="margin:8px 0 0 20px;color:#8a5a00;font-size:13px;">${q.flags.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
            <div style="margin-top:8px;">
                <label style="font-size:12px;">Question text (underlined words are wrapped in [u]...[/u] - edit if needed):</label>
                <textarea id="review-qtext-${qIdx}" rows="2" oninput="importReviewState.questions[${qIdx}].text = this.value">${escapeHtml(q.text)}</textarea>
            </div>
            ${imageBlock}
            ${uploadBlock}
            <button class="btn-secondary" style="width:auto;margin-top:8px;" onclick="reviewResetQuestion(${qIdx})">↺ Reset This Question</button>
            <div style="margin-top:10px;">
                ${letters.map((l, i) => `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
                        <input type="radio" name="review-correct-${qIdx}" value="${l}" ${q.correctLetter === l ? 'checked' : ''} style="width:auto;">
                        <input type="text" id="review-opt-${qIdx}-${i}" value="${escapeHtml(q.options[i] || '')}" placeholder="Option ${l}" style="flex:1;">
                    </div>`).join('')}
            </div>
        `;
        container.appendChild(card);
    });
}

// --- Reading passages: which questions does each passage cover? ---
function renderPassageReview(container) {
    const wrap = document.createElement('div');
    const qs = importReviewState.questions;
    const numOptions = (sel) => qs.map((q, qi) => `<option value="${qi}" ${sel === qi ? 'selected' : ''}>Q${q.number}</option>`).join('');

    wrap.innerHTML = importReviewState.passages.map((p, pIdx) => `
        <div class="review-card passage-review-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:700;margin:0;">
                    <input type="checkbox" style="width:auto;" ${p.include ? 'checked' : ''} onchange="passageSetInclude(${pIdx}, this.checked)">
                    📖 Reading passage ${pIdx + 1} - use it
                </label>
                <button type="button" class="btn-danger" style="width:auto;margin:0;padding:6px 12px;font-size:12px;" onclick="passageRemove(${pIdx})">Remove</button>
            </div>
            <label style="margin-top:10px;font-size:12px;">Passage text (underlined words are wrapped in [u]...[/u]):</label>
            <textarea rows="6" oninput="passageSetText(${pIdx}, this.value)">${escapeHtml(p.text)}</textarea>
            <div class="q-passage" id="passage-preview-${pIdx}" style="margin-top:8px;">${formatPassageHtml(p.text)}</div>

            <label style="margin-top:10px;">This passage covers these questions:</label>
            <div class="passage-q-grid">
                ${qs.map((q, qi) => `
                    <label class="passage-q-chip">
                        <input type="checkbox" style="width:auto;" ${p.selected.includes(qi) ? 'checked' : ''} onchange="passageToggleQ(${pIdx}, ${qi}, this.checked)">
                        Q${q.number}
                    </label>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:13px;">
                Quick select: from
                <select id="passage-from-${pIdx}" style="width:auto;">${numOptions(p.selected.length ? Math.min(...p.selected) : 0)}</select>
                to
                <select id="passage-to-${pIdx}" style="width:auto;">${numOptions(p.selected.length ? Math.max(...p.selected) : 0)}</select>
                <button type="button" class="btn-gold" style="width:auto;margin:0;padding:6px 12px;font-size:12px;" onclick="passageSelectRange(${pIdx})">Select range</button>
            </div>
            <p class="passage-note">${p.note ? escapeHtml(p.note) : 'Tick every question this passage belongs to.'}</p>
        </div>`).join('') + `
        <button type="button" class="btn-info" style="margin:12px 0 0;" onclick="passageAdd()">➕ Add a passage manually</button>`;
    container.appendChild(wrap);
}

function passageSetInclude(pIdx, on) { importReviewState.passages[pIdx].include = on; }
function passageSetText(pIdx, value) {
    importReviewState.passages[pIdx].text = value;
    const prev = document.getElementById(`passage-preview-${pIdx}`);
    if (prev) prev.innerHTML = formatPassageHtml(value);
}
function passageToggleQ(pIdx, qIdx, on) {
    const p = importReviewState.passages[pIdx];
    p.selected = p.selected.filter(i => i !== qIdx);
    if (on) p.selected.push(qIdx);
}
function passageSelectRange(pIdx) {
    const a = parseInt(document.getElementById(`passage-from-${pIdx}`).value, 10);
    const b = parseInt(document.getElementById(`passage-to-${pIdx}`).value, 10);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const p = importReviewState.passages[pIdx];
    p.selected = [];
    for (let i = lo; i <= hi; i++) p.selected.push(i);
    p.note = `Selected Q${importReviewState.questions[lo].number} to Q${importReviewState.questions[hi].number}.`;
    renderImportReview();
}
function passageRemove(pIdx) {
    importReviewState.passages.splice(pIdx, 1);
    renderImportReview();
}
function passageAdd() {
    importReviewState.passages.push({ id: Date.now(), text: '', afterIndex: -1, include: true, selected: [], note: 'Type or paste the passage, then tick the questions it covers.' });
    renderImportReview();
}

function reviewRemoveImage(qIdx) {
    importReviewState.questions[qIdx].image = null;
    renderImportReview();
}

function reviewUploadImage(event, qIdx) {
    const file = event.target.files[0];
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        alert("Invalid image type. Please select a PNG, JPG, JPEG, or WEBP image.");
        event.target.value = "";
        return;
    }
    compressAndResizeImage(file, 800, 800, 0.85, (dataUrl) => {
        importReviewState.questions[qIdx].image = dataUrl;
        renderImportReview();
    });
}

function reviewResetQuestion(qIdx) {
    importReviewState.questions[qIdx] = JSON.parse(JSON.stringify(importReviewState.originalQuestions[qIdx]));
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
    const saveBatchId = 'pdf_' + Date.now();
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
            question_text: (importReviewState.questions[qIdx].text || '').trim() || `Question ${importReviewState.questions[qIdx].number}`,
            option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3], option_e: opts[4],
            correct_answer: correctRadio.value,
            question_number: 0, // set below once we know the starting number
            image: importReviewState.questions[qIdx].image,
            source: 'pdf',
            batch_id: saveBatchId,
            _qIdx: qIdx
        });
    });

    // Attach each chosen passage to every question the teacher ticked for it.
    let passagesUsed = 0;
    importReviewState.passages.forEach(p => {
        const text = (p.text || '').trim();
        if (!p.include || !text || p.selected.length === 0) return;
        let attached = false;
        rowsToSave.forEach(row => { if (p.selected.includes(row._qIdx)) { row.passage = text; attached = true; } });
        if (attached) passagesUsed++;
    });
    rowsToSave.forEach(row => { delete row._qIdx; });

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
            msg.innerText = /passage/.test(error.message || '')
                ? "Passages need a one-time database update first (add the passage column to the questions table). Nothing was saved."
                : `Save failed: ${error.message}`;
            msg.style.color = "#d9534f";
            return;
        }

        msg.innerText = `${rowsToSave.length} question(s) saved to your Question Bank!` +
            (passagesUsed > 0 ? ` ${passagesUsed} passage(s) attached.` : '') +
            (skipped > 0 ? ` (${skipped} left out - unchecked or still incomplete.)` : '');
        msg.style.color = "#28a745";

        document.getElementById('pdf-review-list').innerHTML = "";
        document.getElementById('pdf-summary-box').classList.add('hidden');
        document.getElementById('pdf-save-all-btn').classList.add('hidden');
        document.getElementById('pdf-file-input').value = "";
        importReviewState = { questions: [], originalQuestions: [], leftoverImages: [], passages: [] };
        renderQuestionBank();
    } catch (err) {
        msg.innerText = "Unable to connect to database while saving.";
        msg.style.color = "#d9534f";
    }
}

function downloadPdfGuide() {
    const blob = new Blob([PDF_GUIDE_TEXT], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PDF_Question_Setting_Guide.txt';
    a.click();
    URL.revokeObjectURL(url);
}
