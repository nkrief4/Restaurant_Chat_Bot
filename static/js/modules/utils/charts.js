let chartJsReadyPromise = null;

export async function ensureChartJsLibrary() {
    if (typeof window === "undefined") {
        return null;
    }
    if (typeof window.Chart !== "undefined") {
        return window.Chart;
    }
    if (chartJsReadyPromise) {
        return chartJsReadyPromise;
    }

    chartJsReadyPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector("script[data-chartjs]") || document.querySelector("script[src*='chart.umd']");

        const attachListeners = (script) => {
            if (!script) {
                reject(new Error("CHARTJS_SCRIPT_MISSING"));
                return;
            }
            script.addEventListener(
                "load",
                () => {
                    if (typeof window.Chart !== "undefined") {
                        resolve(window.Chart);
                    } else {
                        reject(new Error("CHARTJS_UNAVAILABLE"));
                    }
                },
                { once: true },
            );
            script.addEventListener(
                "error",
                () => {
                    reject(new Error("CHARTJS_LOAD_FAILED"));
                },
                { once: true },
            );
        };

        if (existingScript) {
            attachListeners(existingScript);
            return;
        }

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
        script.defer = true;
        script.dataset.chartjs = "true";
        document.head.appendChild(script);
        attachListeners(script);
    })
        .then((lib) => {
            return lib;
        })
        .catch((error) => {
            chartJsReadyPromise = null;
            throw error;
        });

    return chartJsReadyPromise;
}
