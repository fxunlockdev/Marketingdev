"use client";
import { useEffect, useRef, useState } from "react";
import { Canvas, FabricImage, Textbox } from "fabric";
import type { Design } from "../../api/src/creative-design";
import { api } from "./api";
import { Field, Notice } from "./primitives";
export type { Design };

// Only typed text layers enter Fabric. Never deserialize arbitrary Fabric JSON or URLs.
export function CreativeEditor({
  businessId,
  design,
  onChange,
  readOnly = false,
  onExportReady,
}: {
  businessId: string;
  design: Design;
  onChange: (design: Design) => void;
  readOnly?: boolean;
  onExportReady: (download: (() => void) | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    element = useRef<HTMLCanvasElement>(null),
    canvas = useRef<Canvas | null>(null),
    current = useRef({ design, onChange, readOnly }),
    [selected, setSelected] = useState(design.layers[0]?.id ?? ""),
    [error, setError] = useState<unknown>(),
    [ready, setReady] = useState(false),
    [retry, setRetry] = useState(0);
  current.current = { design, onChange, readOnly };
  const exportRef = useRef(onExportReady);
  exportRef.current = onExportReady;
  useEffect(() => {
    let active = true,
      url: string | undefined;
    const controller = new AbortController();
    setError(undefined);
    setReady(false);
    exportRef.current(null);
    const c = new Canvas(element.current!, {
      width: design.width,
      height: design.height,
      selection: false,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
    });
    canvas.current = c;
    c.upperCanvasEl.setAttribute("aria-hidden", "true");
    c.upperCanvasEl.tabIndex = -1;
    const fit = () => {
      const w = Math.min(host.current!.clientWidth, design.width);
      c.setDimensions(
        { width: `${w}px`, height: `${(w * design.height) / design.width}px` },
        { cssOnly: true },
      );
      c.calcOffset();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host.current!);
    fit();
    const select = () => {
      const target = c.getActiveObject();
      if (target) setSelected((target as any).layerId);
    };
    c.on("selection:created", select);
    c.on("selection:updated", select);
    c.on("object:modified", ({ target }) => {
      if (!target || current.current.readOnly) return;
      const d = current.current.design,
        id = (target as any).layerId;
      current.current.onChange({
        ...d,
        layers: d.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                x: Math.max(
                  0,
                  Math.min(d.width - l.width, Math.round(target.left)),
                ),
                y: Math.max(0, Math.min(d.height - 1, Math.round(target.top))),
              }
            : l,
        ),
      });
    });
    (async () => {
      try {
        const grant = await api(
          `/api/v1/businesses/${businessId}/creative-media/${design.background_media_id}`,
        );
        if (!active) return;
        const response = await fetch(grant.url, {
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("The private image could not be loaded. Try again.");
        const blob = await response.blob();
        if (blob.type !== "image/png" || blob.size > 20 * 1024 * 1024)
          throw new Error("This image could not be opened safely.");
        if (!active) return;
        url = URL.createObjectURL(blob);
        const image = await FabricImage.fromURL(url, {
          signal: controller.signal,
        });
        if (!active) {
          image.dispose();
          return;
        }
        image.set({ originX: "left", originY: "top", left: 0, top: 0 });
        c.backgroundImage = image;
        c.requestRenderAll();
        setReady(true);
        exportRef.current(() => {
          const link = document.createElement("a");
          link.download = "desvio-creative.png";
          link.href = c.toDataURL({
            format: "png",
            multiplier: 1,
            enableRetinaScaling: false,
          });
          link.click();
        });
      } catch (e) {
        if (active) setError(e);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      observer.disconnect();
      exportRef.current(null);
      canvas.current = null;
      void c.dispose();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    businessId,
    design.background_media_id,
    design.width,
    design.height,
    retry,
  ]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ids = new Set(design.layers.map((l) => l.id));
    for (const o of [...c.getObjects()])
      if (!ids.has((o as any).layerId)) c.remove(o);
    for (const l of design.layers) {
      let text = c.getObjects().find((o) => (o as any).layerId === l.id) as
        | Textbox
        | undefined;
      if (!text) {
        text = new Textbox(l.text, {
          originX: "left",
          originY: "top",
          editable: false,
          hasControls: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          splitByGrapheme: true,
          strokeWidth: 0,
          padding: 4,
        });
        (text as any).layerId = l.id;
        c.add(text);
      }
      text.set({
        text: l.text,
        left: l.x,
        top: l.y,
        width: l.width,
        fontSize: l.fontSize,
        fontFamily: l.fontFamily,
        fill: l.fill,
        textAlign: l.align,
        selectable: !readOnly,
        evented: !readOnly,
        lockMovementX: readOnly,
        lockMovementY: readOnly,
      });
      text.setCoords();
    }
    c.requestRenderAll();
  }, [design, readOnly, retry]);
  const layer =
    design.layers.find((l) => l.id === selected) ?? design.layers[0];
  function update(values: Partial<Design["layers"][number]>) {
    if (!layer) return;
    onChange({
      ...design,
      layers: design.layers.map((l) =>
        l.id === layer.id ? { ...l, ...values } : l,
      ),
    });
  }
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(e) => {
            if (e.target.value !== "") {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) change(Math.max(min, Math.min(max, n)));
            }
          }}
        />
      )}
    </Field>
  );
  return (
    <div className="creative-editor">
      <section className="creative-artboard" aria-label="Creative preview">
        <div
          ref={host}
          className="creative-surface"
          aria-busy={!ready && !error}
        >
          <canvas
            ref={element}
            aria-label="Visual preview. Use the text layer fields to edit with a keyboard."
          />
        </div>
        {!ready && !error && <p role="status">Loading your private image…</p>}
        <Notice error={error} />
        {!!error && (
          <button onClick={() => setRetry((n) => n + 1)}>Reload image</button>
        )}
        <p className="hint">
          {design.width} × {design.height} ·{" "}
          {readOnly
            ? "Saved version"
            : "Drag text to position it, or use the fields below."}
        </p>
      </section>
      <fieldset className="creative-layer-controls" disabled={readOnly}>
        <legend>Text layers</legend>
        <Field label="Selected layer">
          {(id) => (
            <select
              id={id}
              value={layer?.id ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                const c = canvas.current,
                  o = c
                    ?.getObjects()
                    .find((o) => (o as any).layerId === e.target.value);
                if (c && o) {
                  c.setActiveObject(o);
                  c.requestRenderAll();
                }
              }}
            >
              {design.layers.map((l, i) => (
                <option key={l.id} value={l.id}>
                  {i + 1}. {l.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        {layer && (
          <>
            <Field label="Layer text">
              {(id) => (
                <textarea
                  id={id}
                  maxLength={1000}
                  value={layer.text}
                  onChange={(e) => update({ text: e.target.value })}
                />
              )}
            </Field>
            <div className="creative-fields">
              <Field label="Font">
                {(id) => (
                  <select
                    id={id}
                    value={layer.fontFamily}
                    onChange={(e) =>
                      update({ fontFamily: e.target.value as any })
                    }
                  >
                    {["Arial", "Georgia", "Verdana"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
              {number("Font size", layer.fontSize, 8, 200, (n) =>
                update({ fontSize: n }),
              )}
              <Field label="Text color">
                {(id) => (
                  <input
                    id={id}
                    type="color"
                    value={layer.fill}
                    onChange={(e) => update({ fill: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Alignment">
                {(id) => (
                  <select
                    id={id}
                    value={layer.align}
                    onChange={(e) => update({ align: e.target.value as any })}
                  >
                    {["left", "center", "right"].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                )}
              </Field>
              {number(
                "Left position",
                layer.x,
                0,
                design.width - layer.width,
                (n) => update({ x: n }),
              )}
              {number("Top position", layer.y, 0, design.height - 1, (n) =>
                update({ y: n }),
              )}
              {number(
                "Text width",
                layer.width,
                10,
                design.width - layer.x,
                (n) => update({ width: n }),
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...design,
                  layers: design.layers.filter((l) => l.id !== layer.id),
                })
              }
            >
              Remove text layer
            </button>
          </>
        )}
        <button
          type="button"
          disabled={design.layers.length >= 10}
          onClick={() => {
            const id = "text-" + crypto.randomUUID().slice(0, 8);
            onChange({
              ...design,
              layers: [
                ...design.layers,
                {
                  id,
                  type: "text",
                  text: "Your text",
                  x: Math.round(design.width * 0.07),
                  y: Math.round(design.height * 0.4),
                  width: Math.round(design.width * 0.86),
                  fontSize: 40,
                  fontFamily: "Arial",
                  fill: "#201e1d",
                  align: "left",
                },
              ],
            });
            setSelected(id);
          }}
        >
          Add text layer
        </button>
      </fieldset>
    </div>
  );
}
