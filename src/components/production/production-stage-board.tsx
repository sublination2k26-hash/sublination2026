"use client";

import { useState } from "react";
import "./production-stage-board.css";

type ProductionStageJob = {
  id: string;
  customer: string;
  item: string;
  qty: number;
  due: string;
  stage: string;
};

type ProductionStageBoardProps = {
  stages: string[];
  orders: ProductionStageJob[];
  onSelect: (id: string) => void;
};

export function ProductionStageBoard({ stages, orders, onSelect }: ProductionStageBoardProps) {
  const [selectedStage, setSelectedStage] = useState(stages[0] ?? "");
  const activeStage = stages.includes(selectedStage) ? selectedStage : stages[0] ?? "";
  const stageOrders = orders.filter(order => order.stage === activeStage);

  return <section className="production-stage-board">
    <div className="production-stage-pills" role="group" aria-label="Production stages">
      {stages.map(stage => {
        const count = orders.filter(order => order.stage === stage).length;
        return <button
          key={stage}
          type="button"
          className="production-stage-pill"
          aria-pressed={activeStage === stage}
          onClick={() => setSelectedStage(stage)}
        >
          {stage}<span>{count}</span>
        </button>;
      })}
    </div>
    <div className="production-stage-jobs">
      {stageOrders.length ? stageOrders.map(order => <button
        className="job-card"
        key={order.id}
        onClick={() => onSelect(order.id)}
      >
        <small>{order.id}</small>
        <b>{order.customer}</b>
        <span>{order.item}</span>
        <div>{order.qty} pcs <span>Due {order.due}</span></div>
        <em>{order.stage === "Quality check" ? "Inspect & approve" : "Open job"}</em>
      </button>) : <div className="lane-empty">No jobs</div>}
    </div>
  </section>;
}
