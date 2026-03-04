/* ─── State ───────────────────────────────────────────────────────────── */
const state = {
  problemImage: null,   // { base64, type }
  referenceImage: null, // { base64, type }
  subject: "auto",      // "auto" | "math" | "science" | "history" | "english"
};

/* ─── DOM refs ────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const inputCard     = $("input-card");
const loadingCard   = $("loading-card");
const answerCard    = $("answer-card");
const errorCard     = $("error-card");
const loadingStatus = $("loading-status");
const previews      = $("previews");
const questionInput = $("question");
const submitBtn     = $("submit-btn");
const resetBtn      = $("reset-btn");

/* ─── Subject selector ────────────────────────────────────────────────── */
document.querySelectorAll(".subject-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subject-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.subject = btn.dataset.subject;
  });
});

/* ─── Image loading ───────────────────────────────────────────────────── */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip data URL prefix — we only want raw base64
      const result = reader.result;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageInput(file, slot) {
  if (!file) return;
  const base64 = await fileToBase64(file);
  state[slot] = { base64, type: file.type || "image/jpeg" };
  renderPreviews();
}

$("problem-img-input").addEventListener("change", (e) => {
  handleImageInput(e.target.files[0], "problemImage");
});
$("reference-img-input").addEventListener("change", (e) => {
  handleImageInput(e.target.files[0], "referenceImage");
});

function renderPreviews() {
  previews.innerHTML = "";
  for (const [slot, label] of [["problemImage", "Problem"], ["referenceImage", "Reference"]]) {
    if (!state[slot]) continue;
    const div = document.createElement("div");
    div.className = "preview-thumb";
    div.title = label;
    const img = document.createElement("img");
    img.src = `data:${state[slot].type};base64,${state[slot].base64}`;
    img.alt = label;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.textContent = "×";
    btn.setAttribute("aria-label", `Remove ${label} image`);
    btn.addEventListener("click", () => {
      state[slot] = null;
      renderPreviews();
    });
    div.append(img, btn);
    previews.appendChild(div);
  }
}

/* ─── Status messages ─────────────────────────────────────────────────── */
const STATUS_MESSAGES = [
  "Reading your homework...",
  "Understanding the problem...",
  "Solving...",
  "Writing your explanation...",
  "Almost done...",
];
let statusIdx = 0;
let statusTimer = null;

function startStatusCycle() {
  statusIdx = 0;
  loadingStatus.textContent = STATUS_MESSAGES[0];
  statusTimer = setInterval(() => {
    statusIdx = Math.min(statusIdx + 1, STATUS_MESSAGES.length - 1);
    loadingStatus.textContent = STATUS_MESSAGES[statusIdx];
  }, 3500);
}
function stopStatusCycle() {
  clearInterval(statusTimer);
}

/* ─── Show/hide cards ─────────────────────────────────────────────────── */
function showCard(which) {
  [inputCard, loadingCard, answerCard, errorCard].forEach((c) => c.classList.add("hidden"));
  which.classList.remove("hidden");
}

/* ─── Submit ──────────────────────────────────────────────────────────── */
submitBtn.addEventListener("click", submitQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitQuestion();
});

async function submitQuestion() {
  const question = questionInput.value.trim();
  if (!question && !state.problemImage) {
    questionInput.focus();
    return;
  }

  showCard(loadingCard);
  startStatusCycle();

  const body = { question };
  if (state.subject !== "auto") body.subject = state.subject;
  if (state.problemImage) {
    body.problemImageBase64 = state.problemImage.base64;
    body.problemImageType   = state.problemImage.type;
  }
  if (state.referenceImage) {
    body.referenceImageBase64 = state.referenceImage.base64;
    body.referenceImageType   = state.referenceImage.type;
  }

  try {
    const resp = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    stopStatusCycle();

    if (data.error && !data.explanation) {
      showError(data.error);
    } else {
      renderAnswer(data);
    }
  } catch (err) {
    stopStatusCycle();
    showError("Could not reach the server. Is it running?");
  }
}

/* ─── Render answer ───────────────────────────────────────────────────── */
function renderAnswer(data) {
  // Badge
  const badge = $("subject-badge");
  badge.textContent = capitalize(data.subject || "unknown");
  badge.className = `subject-badge badge-${data.subject || "unknown"}`;

  // Problem
  const problemEl = $("problem-text");
  problemEl.textContent = data.problem || "";

  // Answer box (math only)
  const answerSection = $("answer-section");
  const answerValue   = $("answer-value");
  if (data.answer) {
    answerSection.classList.remove("hidden");
    answerValue.textContent = data.answer;
  } else {
    answerSection.classList.add("hidden");
  }

  // Steps (math only)
  const stepsSection = $("steps-section");
  const stepsList    = $("steps-list");
  if (data.steps && data.steps.length > 0) {
    stepsSection.classList.remove("hidden");
    stepsList.innerHTML = "";
    data.steps.forEach((step, i) => {
      const li   = document.createElement("li");
      li.className = "step-item";
      const num  = document.createElement("span");
      num.className = "step-num";
      num.textContent = i + 1;
      const text = document.createElement("span");
      text.textContent = step.replace(/^Step\s+\d+[:.]\s*/i, "");
      li.append(num, text);
      stepsList.appendChild(li);
    });
  } else {
    stepsSection.classList.add("hidden");
  }

  // Corrected text (English only)
  const correctedSection = $("corrected-section");
  const correctedEl      = $("corrected-text");
  if (data.corrected) {
    correctedSection.classList.remove("hidden");
    correctedEl.textContent = data.corrected;
  } else {
    correctedSection.classList.add("hidden");
  }

  // Explanation
  const explanationEl = $("explanation-text");
  explanationEl.textContent = data.explanation || "";

  showCard(answerCard);

  // Render KaTeX after DOM is updated
  if (window.renderMathInElement) {
    setTimeout(() => {
      try {
        renderMathInElement(answerCard, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          throwOnError: false,
        });
      } catch (e) {
        // KaTeX errors are non-fatal
      }
    }, 50);
  }
}

function showError(message) {
  $("error-message").textContent = message;
  showCard(errorCard);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ─── Reset ───────────────────────────────────────────────────────────── */
resetBtn.addEventListener("click", reset);
$("error-reset-btn").addEventListener("click", reset);

function reset() {
  state.problemImage   = null;
  state.referenceImage = null;
  state.subject        = "auto";
  questionInput.value  = "";
  document.querySelectorAll(".subject-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.subject-btn[data-subject="auto"]').classList.add("active");
  renderPreviews();
  // Reset file inputs so same file can be re-selected
  $("problem-img-input").value   = "";
  $("reference-img-input").value = "";
  showCard(inputCard);
  questionInput.focus();
}
