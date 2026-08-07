// The mobile number is the last path segment: /survey/results/{mobile}
const mobile = window.location.pathname.split("/").filter(Boolean).pop();

let currentFarmer = null;
let editing = false;

const editableFields = ["name", "village", "crop", "acres", "experience"];

const editBtn = document.getElementById("edit-btn");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");
const deleteBtn = document.getElementById("delete-btn");

async function loadDetail() {

    const loading = document.getElementById("detail-loading");
    const errorBox = document.getElementById("detail-error");
    const content = document.getElementById("detail-content");

    try {

        const response = await fetch(`/survey/results/${encodeURIComponent(mobile)}/data`);

        if (!response.ok) {

            loading.style.display = "none";
            errorBox.style.display = "block";
            return;
        }

        const farmer = await response.json();
        currentFarmer = farmer;

        loading.style.display = "none";

        renderFarmer(farmer);

        content.style.display = "grid";

    } catch (error) {

        console.error(error);

        loading.style.display = "none";
        errorBox.innerText = "Failed to load farmer details.";
        errorBox.style.display = "block";
    }
}

function renderFarmer(farmer) {

    document.getElementById("detail-mobile").innerText = farmer.mobile;
    document.getElementById("detail-name").innerText = farmer.name || "—";
    document.getElementById("detail-village").innerText = farmer.village || "—";
    document.getElementById("detail-crop").innerText = farmer.crop || "—";
    document.getElementById("detail-acres").innerText =
        farmer.acres !== null ? `${farmer.acres} Acres` : (farmer.acres_raw || "—");
    document.getElementById("detail-experience").innerText =
        farmer.experience !== null ? `${farmer.experience} Years` : (farmer.experience_raw || "—");

    renderIssues(farmer);
}

function renderIssues(farmer) {

    const issuesBox = document.getElementById("detail-issues");
    issuesBox.innerHTML = "";

    farmer.issues.forEach(issue => {

        const row = document.createElement("div");
        row.className = issue.ok ? "issue-row issue-ok" : "issue-row issue-fail";
        row.innerText = `${issue.ok ? "✓" : "⚠"} ${issue.message}`;

        issuesBox.appendChild(row);
    });

    const overall = document.getElementById("detail-overall");
    overall.innerText = farmer.status;
    overall.className = farmer.status === "OK" ? "status-pill status-ok" : "status-pill status-review";
}

// ----------------------------
// Edit mode
// ----------------------------

function enterEditMode() {

    editing = true;

    editBtn.style.display = "none";
    deleteBtn.style.display = "none";
    saveBtn.style.display = "inline-flex";
    cancelBtn.style.display = "inline-flex";

    const rawValues = {
        name: currentFarmer.name || "",
        village: currentFarmer.village || "",
        crop: currentFarmer.crop || "",
        acres: currentFarmer.acres_raw || "",
        experience: currentFarmer.experience_raw || ""
    };

    editableFields.forEach(field => {

        const el = document.getElementById(`detail-${field}`);

        const input = document.createElement("input");
        input.type = "text";
        input.className = "detail-edit-input";
        input.id = `edit-input-${field}`;
        input.value = rawValues[field];

        el.replaceWith(input);
    });
}

function exitEditMode(cancelled) {

    editing = false;

    editBtn.style.display = "inline-flex";
    deleteBtn.style.display = "inline-flex";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";

    editableFields.forEach(field => {

        const input = document.getElementById(`edit-input-${field}`);

        if (!input) return;

        const span = document.createElement("span");
        span.className = "detail-value";
        span.id = `detail-${field}`;

        input.replaceWith(span);
    });

    renderFarmer(currentFarmer);
}

async function saveEdits() {

    const payload = {};

    editableFields.forEach(field => {
        const input = document.getElementById(`edit-input-${field}`);
        payload[field] = input ? input.value.trim() : "";
    });

    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";

    try {

        const response = await fetch(`/survey/results/${encodeURIComponent(mobile)}/data`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            alert("Failed to save changes.");
            saveBtn.disabled = false;
            saveBtn.innerText = "💾 Save";
            return;
        }

        const updated = await response.json();
        currentFarmer = updated;

        saveBtn.disabled = false;
        saveBtn.innerText = "💾 Save";

        exitEditMode(false);

    } catch (error) {

        console.error(error);
        alert("Failed to save changes.");
        saveBtn.disabled = false;
        saveBtn.innerText = "💾 Save";
    }
}

async function deleteThisFarmer() {

    if (!confirm(`Delete this survey response (${mobile})? This cannot be undone.`)) {
        return;
    }

    try {

        const response = await fetch(`/survey/results/${encodeURIComponent(mobile)}/data`, {
            method: "DELETE"
        });

        if (!response.ok) {
            alert("Failed to delete this response.");
            return;
        }

        window.location.href = "/survey/results";

    } catch (error) {

        console.error(error);
        alert("Failed to delete this response.");
    }
}

editBtn.addEventListener("click", enterEditMode);
cancelBtn.addEventListener("click", () => exitEditMode(true));
saveBtn.addEventListener("click", saveEdits);
deleteBtn.addEventListener("click", deleteThisFarmer);

window.addEventListener("DOMContentLoaded", loadDetail);