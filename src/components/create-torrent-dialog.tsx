"use client"

import * as React from "react"
import {
  Check,
  Download,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatSize } from "@/lib/formatters"
import { useI18n } from "@/lib/i18n-context"
import { rpc } from "@/lib/rpc-client"

interface CreateTorrentDialogProps {
  children: React.ReactNode
  onSuccess?: () => void
}

const REMOVED_HELPER_TOKEN_KEY = "transmission_torrent_helper_token"

function defaultHelperUrl() {
  return import.meta.env.DEV
    ? "/torrent-helper"
    : `${window.location.protocol}//${window.location.hostname}:3001`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function CreateTorrentDialog({ children, onSuccess }: CreateTorrentDialogProps) {
  const { t: translate } = useI18n()
  const t = React.useCallback((key: string, args?: Record<string, unknown> | string, defaultValue?: string) =>
    translate(key.startsWith("create_torrent.") ? `common.${key}` : key, args, defaultValue),
  [translate])
  const [open, setOpen] = React.useState(false)
  const [sourcePath, setSourcePath] = React.useState("")
  const [validatedPath, setValidatedPath] = React.useState("")
  const [availableSpace, setAvailableSpace] = React.useState<number | null>(null)
  const [trackers, setTrackers] = React.useState("")
  const [comment, setComment] = React.useState("")
  const [isPrivate, setIsPrivate] = React.useState(false)
  const [pieceSize, setPieceSize] = React.useState("auto")
  const [isValidating, setIsValidating] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [error, setError] = React.useState("")
  const [jobId, setJobId] = React.useState("")
  const [metainfo, setMetainfo] = React.useState("")

  const helperRequest = React.useCallback(async (route: string, init?: RequestInit) => {
    const response = await fetch(`${defaultHelperUrl()}${route}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
    return body
  }, [])

  React.useEffect(() => {
    if (!open) return
    localStorage.removeItem(REMOVED_HELPER_TOKEN_KEY)
    if (!sourcePath) {
      void rpc.getSession().then((session) => {
        setSourcePath(session["download-dir"] || "")
      }).catch(() => {})
    }
  }, [open, sourcePath])

  const validatePath = async () => {
    const path = sourcePath.trim()
    if (!path) return
    setIsValidating(true)
    setError("")
    setValidatedPath("")
    setAvailableSpace(null)
    try {
      const result = await rpc.freeSpace(path)
      if (result["size-bytes"] < 0) throw new Error(t("create_torrent.path_not_accessible"))
      setValidatedPath(path)
      setAvailableSpace(result["size-bytes"])
    } catch (requestError) {
      setError(`${t("create_torrent.path_check_failed")}: ${errorMessage(requestError)}`)
    } finally {
      setIsValidating(false)
    }
  }

  React.useEffect(() => {
    if (!open || !jobId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const status = await helperRequest(`/api/jobs/${jobId}`) as {
          state: string
          error?: string
          metainfo?: string
        }
        if (disposed) return
        if (status.state === "complete" && status.metainfo) {
          setMetainfo(status.metainfo)
          setJobId("")
          setCreating(false)
          toast.success(t("create_torrent.created"))
        } else if (status.state === "failed") {
          throw new Error(status.error || t("create_torrent.failed"))
        } else if (status.state === "cancelled") {
          setJobId("")
          setCreating(false)
        } else {
          timer = setTimeout(poll, 1000)
        }
      } catch (pollError) {
        if (!disposed) {
          setError(errorMessage(pollError))
          setJobId("")
          setCreating(false)
        }
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [helperRequest, jobId, open, t])

  const createTorrent = async () => {
    const trackerList = trackers.split(/[\r\n]+/).map((item) => item.trim()).filter(Boolean)
    const path = sourcePath.trim()
    if (!path || validatedPath !== path) return
    if (isPrivate && !trackerList.length) {
      setError(t("create_torrent.private_tracker_required"))
      return
    }
    setCreating(true)
    setError("")
    try {
      const result = await helperRequest("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          path,
          trackers: trackerList,
          private: isPrivate,
          comment,
          ...(pieceSize === "auto" ? {} : { pieceSize: Number(pieceSize) }),
        }),
      }) as { jobId: string }
      setJobId(result.jobId)
    } catch (requestError) {
      setError(errorMessage(requestError))
      setCreating(false)
    }
  }

  const cancelCreation = async () => {
    if (jobId) {
      try {
        await helperRequest(`/api/jobs/${jobId}`, { method: "DELETE" })
      } catch (requestError) {
        setError(errorMessage(requestError))
      }
    }
    setJobId("")
    setCreating(false)
  }

  const downloadTorrent = () => {
    const data = Uint8Array.from(atob(metainfo), (character) => character.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([data], { type: "application/x-bittorrent" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${sourcePath.split(/[\\/]/).filter(Boolean).at(-1) || "torrent"}.torrent`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const addAndVerify = async () => {
    setAdding(true)
    try {
      const data = Uint8Array.from(atob(metainfo), (character) => character.charCodeAt(0))
      const file = new File([data], "created.torrent")
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(reader.error || new Error("Unable to read torrent"))
      })
      const downloadDir = sourcePath.trim().replace(/[\\/][^\\/]+$/, "") || "/"
      const result = await rpc.addTorrent({ metainfo: base64, "download-dir": downloadDir, paused: true })
      const torrent = result["torrent-added"] || result["torrent-duplicate"]
      if (!torrent?.id) throw new Error(t("create_torrent.added_without_id"))
      await rpc.verifyTorrents([torrent.id])
      await rpc.startTorrents([torrent.id])
      toast.success(t("create_torrent.added_and_verified"))
      onSuccess?.()
    } catch (requestError) {
      toast.error(`${t("create_torrent.add_failed")}: ${errorMessage(requestError)}`)
    } finally {
      setAdding(false)
    }
  }

  const closeDialog = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      if (jobId) void helperRequest(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {})
      setValidatedPath("")
      setAvailableSpace(null)
      setMetainfo("")
      setJobId("")
      setCreating(false)
      setError("")
    }
  }

  const trackerCount = trackers.split(/[\r\n]+/).filter((item) => item.trim()).length

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-xl p-0 sm:max-w-none!"
        style={{ width: "min(56rem, calc(100vw - 2rem))" }}
      >
        <div className="border-b px-5 py-5 sm:px-7">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <FolderOpen className="h-5 w-5 text-primary" />{t("create_torrent.title")}
            </DialogTitle>
            <DialogDescription>{t("create_torrent.description")}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-6 px-5 py-5 sm:px-7 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.85fr)]">
          <section className="min-w-0 space-y-5" aria-label={t("create_torrent.source")}>
            <div className="space-y-2">
              <label htmlFor="torrent-source-path" className="text-sm font-medium text-foreground">{t("create_torrent.source_path")}</label>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("create_torrent.source_path_hint")}</p>
              <div className="flex gap-2">
                <Input
                  id="torrent-source-path"
                  value={sourcePath}
                  onChange={(event) => {
                    setSourcePath(event.target.value)
                    setValidatedPath("")
                    setAvailableSpace(null)
                    setMetainfo("")
                    setError("")
                  }}
                  placeholder="/share/NAS/Downloads/Movies"
                  className="h-10 font-mono text-sm"
                  spellCheck={false}
                />
                <Button variant="outline" className="h-10 shrink-0" disabled={!sourcePath.trim() || isValidating} onClick={() => void validatePath()}>
                  {isValidating ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  {t("create_torrent.validate_path")}
                </Button>
              </div>
              {validatedPath === sourcePath.trim() && availableSpace !== null && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("create_torrent.path_valid", { space: formatSize(availableSpace) })}
                </p>
              )}
            </div>

          </section>

          <section className="min-w-0 space-y-4" aria-label={t("create_torrent.options")}>
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              {t("create_torrent.trackers")}
              <Textarea value={trackers} onChange={(event) => setTrackers(event.target.value)} placeholder={t("create_torrent.trackers_placeholder")} className="min-h-24 resize-y text-sm" />
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground"><LockKeyhole className="h-3.5 w-3.5" />{t("create_torrent.private")}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t("create_torrent.private_hint")}</span>
              </span>
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              {t("create_torrent.piece_size")}
              <select value={pieceSize} onChange={(event) => setPieceSize(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground">
                <option value="auto">{t("create_torrent.piece_auto")}</option>
                {[256, 512, 1024, 2048, 4096, 8192, 16384].map((size) => <option key={size} value={size}>{size < 1024 ? `${size} KiB` : `${size / 1024} MiB`}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
              {t("create_torrent.comment")}
              <Input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1024} />
            </label>

            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {creating ? (
              <div className="flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-3 py-3 text-sm">
                <span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-primary" />{t("create_torrent.generating", { count: trackerCount })}</span>
                <Button size="sm" variant="ghost" onClick={() => void cancelCreation()}><X className="mr-1 h-4 w-4" />{t("common.cancel")}</Button>
              </div>
            ) : metainfo ? (
              <div className="space-y-2 rounded-md border border-emerald-600/25 bg-emerald-500/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-emerald-600" />{t("create_torrent.ready")}</p>
                <Button variant="outline" className="w-full" onClick={downloadTorrent}><Download className="mr-2 h-4 w-4" />{t("create_torrent.download")}</Button>
                <Button className="w-full" disabled={adding} onClick={() => void addAndVerify()}>
                  {adding ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{t("create_torrent.add_and_verify")}
                </Button>
              </div>
            ) : (
              <Button className="w-full" disabled={!sourcePath.trim() || validatedPath !== sourcePath.trim()} onClick={() => void createTorrent()}><Plus className="mr-2 h-4 w-4" />{t("create_torrent.create")}</Button>
            )}
          </section>
        </div>
        <DialogFooter className="border-t px-5 py-3 sm:px-7">
          <p className="mr-auto text-xs text-muted-foreground">{t("create_torrent.tracker_count", { count: trackerCount })}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}