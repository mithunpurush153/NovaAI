const mobileInput = document.getElementById("mobile-input");
const mobileError = document.getElementById("mobile-error");

// ----------------------------
// Validate the mobile number, then hand off to the voice survey page.
// The number travels in the URL query string — /survey_ws only needs it
// once, when the voice page sends its "start" message.
// ----------------------------

function startSurvey() {

    const mobile = mobileInput.value.trim();

    if (mobile === "") {

        mobileError.innerText = "Please enter a mobile number.";
        return;
    }

    if (!/^\d{10}$/.test(mobile)) {

        mobileError.innerText = "Please enter a valid 10-digit mobile number.";
        return;
    }

    mobileError.innerText = "";

    window.location.href = `/survey_voice?mobile=${encodeURIComponent(mobile)}`;
}

mobileInput.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {

        e.preventDefault();
        startSurvey();
    }
});