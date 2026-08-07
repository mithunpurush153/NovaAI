async function loadResults() {

    const loading = document.getElementById("results-loading");
    const empty = document.getElementById("results-empty");
    const table = document.getElementById("results-table");
    const tbody = document.getElementById("results-tbody");

    try {

        const response = await fetch("/survey/results/data");
        const farmers = await response.json();

        loading.style.display = "none";

        if (!farmers || farmers.length === 0) {

            empty.style.display = "block";
            return;
        }

        tbody.innerHTML = "";

        farmers.forEach(farmer => {

            const row = document.createElement("tr");

            row.className = "results-row";
            row.onclick = () => {
                window.location.href = `/survey/results/${encodeURIComponent(farmer.mobile)}`;
            };

            const statusClass = farmer.status === "OK" ? "status-ok" : "status-review";
            const statusIcon = farmer.status === "OK" ? "✓" : "⚠";

            row.innerHTML = `
                <td>${escapeHtml(farmer.name)}</td>
                <td>${escapeHtml(farmer.village)}</td>
                <td>${escapeHtml(farmer.crop)}</td>
                <td>${farmer.acres !== null ? farmer.acres : "—"}</td>
                <td>${farmer.experience !== null ? farmer.experience : "—"}</td>
                <td><span class="status-pill ${statusClass}">${statusIcon} ${farmer.status}</span></td>
                <td class="actions-cell">
                    <button class="row-action-btn edit-btn" data-mobile="${escapeHtml(farmer.mobile)}" title="Edit">✏️</button>
                    <button class="row-action-btn delete-btn" data-mobile="${escapeHtml(farmer.mobile)}" title="Delete">🗑️</button>
                </td>
            `;

            const editBtn = row.querySelector(".edit-btn");
            const deleteBtn = row.querySelector(".delete-btn");

            editBtn.onclick = (event) => {
                event.stopPropagation();
                window.location.href = `/survey/results/${encodeURIComponent(farmer.mobile)}`;
            };

            deleteBtn.onclick = (event) => {
                event.stopPropagation();
                deleteFarmer(farmer.mobile);
            };

            tbody.appendChild(row);
        });

        table.style.display = "table";

    } catch (error) {

        console.error(error);

        loading.style.display = "none";
        empty.innerText = "Failed to load survey results.";
        empty.style.display = "block";
    }
}

async function deleteFarmer(mobile) {

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

        loadResults();

    } catch (error) {

        console.error(error);
        alert("Failed to delete this response.");
    }
}

function escapeHtml(text) {

    if (text === null || text === undefined) return "";

    const div = document.createElement("div");
    div.innerText = text;

    return div.innerHTML;
}

window.addEventListener("DOMContentLoaded", loadResults);