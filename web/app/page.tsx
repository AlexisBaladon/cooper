"use client";

import { useEffect, useState } from "react";

type Option = {
  name: string;
  crops: string[];
  illustrative_score: number;
  reason: string;
  benefit: string;
  risk: string;
  missing: string;
};
type Comparison = {
  status: string;
  scenario: string;
  options: Option[];
  notice: string;
};

export default function Home() {
  const [priority, setPriority] = useState("agua");
  const [rain, setRain] = useState(0);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority, rain_change_percent: rain }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("La API no respondió correctamente.");
        return response.json();
      })
      .then((data: Comparison) => { setComparison(data); setError(""); })
      .catch((cause: Error) => {
        if (cause.name !== "AbortError") setError("No se pudo conectar con la API. Iniciá el servidor en el puerto 8000.");
      });
    return () => controller.abort();
  }, [priority, rain]);

  return (
    <main>
      <header className="hero">
        <div className="wrap">
          <p className="eyebrow">NASA Space Apps Challenge 2026 · Uruguay</p>
          <h1>Explorá rotaciones para un campo más resiliente</h1>
          <p>Compará tu manejo actual con alternativas, entendé los supuestos y conversá los riesgos con un técnico local.</p>
          <span className="badge">Prototipo con datos ilustrativos</span>
        </div>
      </header>

      <section className="wrap controls" aria-labelledby="scenario-title">
        <div>
          <p className="eyebrow dark">01 · Escenario</p>
          <h2 id="scenario-title">¿Qué te importa más?</h2>
          <p>Elegí una prioridad y probá una reducción de lluvia. El cálculo es una demostración, no un pronóstico.</p>
        </div>
        <div className="inputs">
          <label htmlFor="priority">Prioridad</label>
          <select id="priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="agua">Ahorrar agua</option>
            <option value="suelo">Cuidar el suelo</option>
            <option value="forraje">Tener forraje</option>
          </select>
          <label htmlFor="rain">Cambio de lluvia: {rain}%</label>
          <input id="rain" type="range" min="-40" max="0" step="10" value={rain} onChange={(event) => setRain(Number(event.target.value))} />
        </div>
      </section>

      <section className="wrap results" aria-labelledby="results-title">
        <p className="eyebrow dark">02 · Comparación</p>
        <h2 id="results-title">Tres caminos para explorar</h2>
        {error && <p className="error" role="alert">{error}</p>}
        {comparison && <>
          <p className="scenario">{comparison.scenario} · {comparison.notice}</p>
          <div className="cards">
            {comparison.options.map((option) => <article className="card" key={option.name}>
              <h3>{option.name}</h3>
              <p className="crops">{option.crops.join(" → ")}</p>
              <p className="score">{option.illustrative_score.toFixed(1)} <small>/ 4 · puntaje ilustrativo</small></p>
              <dl>
                <dt>Por qué explorarla</dt><dd>{option.reason}</dd>
                <dt>Beneficio posible</dt><dd>{option.benefit}</dd>
                <dt>Riesgo a revisar</dt><dd>{option.risk}</dd>
                <dt>Datos faltantes</dt><dd>{option.missing}</dd>
              </dl>
            </article>)}
          </div>
        </>}
      </section>
      <footer className="wrap">Los resultados no sustituyen datos de campo ni el criterio de un agrónomo. <a href="https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/">Ver el desafío oficial</a>.</footer>
    </main>
  );
}
