import { beforeEach, describe, expect, it } from "vitest";
import { addMeasurePoint, angleAt, setMeasureMode, useMeasure } from "../src/ui/measureTool";

describe("Winkel messen", () => {
  beforeEach(() => useMeasure.setState({ active: true, mode: "distance", points: [] }));
  it("berechnet den Winkel am Scheitelpunkt", () => {
    expect(angleAt([10, 0, 0], [0, 0, 0], [0, 10, 0])).toBeCloseTo(90);
    expect(angleAt([10, 0, 0], [0, 0, 0], [10, 10, 0])).toBeCloseTo(45);
    expect(angleAt([10, 0, 0], [0, 0, 0], [-5, 0, 0])).toBeCloseTo(180);
    expect(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBe(0);
  });
  it("sammelt drei Punkte im Winkelmodus und beginnt dann neu", () => {
    setMeasureMode("angle");
    addMeasurePoint([1, 0, 0]);
    addMeasurePoint([0, 0, 0]);
    addMeasurePoint([0, 1, 0]);
    expect(useMeasure.getState().points).toHaveLength(3);
    addMeasurePoint([5, 5, 5]);
    expect(useMeasure.getState().points).toEqual([[5, 5, 5]]);
  });
  it("Moduswechsel verwirft angefangene Punkte", () => {
    addMeasurePoint([1, 0, 0]);
    setMeasureMode("angle");
    expect(useMeasure.getState().points).toEqual([]);
  });
});
