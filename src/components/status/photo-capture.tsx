"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

/** Optional check-in photo. Camera runs only while this dialog is open; one still frame is sent, nothing else. */
export function PhotoCapture({ onCapture, onCancel, busy }: { onCapture: (dataUrl: string) => void; onCancel: () => void; busy: boolean }) {
  const t = useTranslations("photo");
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let active: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false })
      .then((s) => {
        active = s;
        setStream(s);
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError(t("cameraDenied")));
    if (!navigator.mediaDevices) setError(t("cameraUnavailable"));
    return () => active?.getTracks().forEach((tr) => tr.stop());
  }, [t]);

  const capture = () => {
    const v = video.current;
    if (!v) return;
    const w = 480;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(v, 0, 0, w, h);
    setShot(canvas.toDataURL("image/jpeg", 0.75));
    stream?.getTracks().forEach((tr) => tr.stop());
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{t("explain")}</p>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot} alt={t("preview")} className="w-full rounded-md border border-rule" />
      ) : (
        <video ref={video} autoPlay playsInline muted className="w-full rounded-md border border-rule bg-black" />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        {shot ? (
          <Button onClick={() => onCapture(shot)} disabled={busy}>
            {t("useAndCheckIn")}
          </Button>
        ) : (
          <Button onClick={capture} disabled={!stream || busy}>
            {t("take")}
          </Button>
        )}
      </div>
    </div>
  );
}
