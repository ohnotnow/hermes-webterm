const form = document.getElementById("pin-form") as HTMLFormElement;
const status = document.getElementById("status") as HTMLDivElement;
const inputs = Array.from(form.querySelectorAll("input")) as HTMLInputElement[];

fetch("/api/me").then(async (r) => {
  const data = await r.json().catch(() => ({}));
  if (data.authed) window.location.href = "/terminal";
}).catch(() => {});

inputs[0]?.focus();

inputs.forEach((input, idx) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value && idx < inputs.length - 1) {
      inputs[idx + 1].focus();
    }
    if (inputs.every((i) => i.value)) {
      submit();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && idx > 0) {
      inputs[idx - 1].focus();
      inputs[idx - 1].value = "";
      e.preventDefault();
    }
    if (e.key === "ArrowLeft" && idx > 0) inputs[idx - 1].focus();
    if (e.key === "ArrowRight" && idx < inputs.length - 1) inputs[idx + 1].focus();
  });

  input.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    const digits = text.replace(/\D/g, "").slice(0, inputs.length);
    if (!digits) return;
    e.preventDefault();
    digits.split("").forEach((d, i) => {
      if (inputs[i]) inputs[i].value = d;
    });
    if (digits.length === inputs.length) submit();
    else inputs[digits.length]?.focus();
  });
});

let submitting = false;

async function submit() {
  if (submitting) return;
  submitting = true;
  const pin = inputs.map((i) => i.value).join("");
  status.textContent = " ";
  status.classList.remove("ok");

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (res.ok) {
      status.textContent = "OK";
      status.classList.add("ok");
      window.location.href = "/terminal";
      return;
    }

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const secs = Math.ceil((data.retryAfterMs ?? 30000) / 1000);
      status.textContent = `Too many tries. Wait ${secs}s.`;
    } else {
      status.textContent = "Wrong PIN";
    }
    form.classList.add("shake");
    setTimeout(() => form.classList.remove("shake"), 400);
    inputs.forEach((i) => (i.value = ""));
    inputs[0].focus();
  } catch {
    status.textContent = "Network error";
  } finally {
    submitting = false;
  }
}
