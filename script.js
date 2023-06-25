const conversionRatio = 4124.08 / 411.59;

function convertSpxToSpy() {
    const spxValue = parseFloat(document.getElementById("spx-input").value);
    const spyValue = spxValue / conversionRatio;
    document.getElementById("spy-result").innerText = `SPY: ${spyValue.toFixed(2)}`;
}

function convertSpyToSpx() {
    const spyValue = parseFloat(document.getElementById("spy-input").value);
    const spxValue = spyValue * conversionRatio;
    document.getElementById("spx-result").innerText = `SPX: ${spxValue.toFixed(2)}`;
}
