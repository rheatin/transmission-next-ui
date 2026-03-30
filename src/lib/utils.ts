import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Torrent } from "@/lib/rpc-types"
import { getStatusLabel } from "@/lib/formatters"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isActiveTorrent(torrent: Torrent): boolean {
  return torrent.rateDownload > 0 || torrent.rateUpload > 0
}

export function isDownloadingTorrent(torrent: Torrent): boolean {
  return [3, 4].includes(torrent.status)
}

export function isSeedingTorrent(torrent: Torrent): boolean {
  return [5, 6].includes(torrent.status)
}

export function isPausedTorrent(torrent: Torrent): boolean {
  return torrent.status === 0
}

export function filterTorrentByStatus(torrent: Torrent, statusFilter: string, t?: (key: string) => string): boolean {
  const filter = statusFilter.toLowerCase()

  if (filter === "active") return isActiveTorrent(torrent)
  if (filter === "downloading") return isDownloadingTorrent(torrent)
  if (filter === "seeding") return isSeedingTorrent(torrent)
  if (filter === "stopped" || filter === "paused") return isPausedTorrent(torrent)

  const statusText = t ? t(getStatusLabel(torrent.status)).toLowerCase() : getStatusLabel(torrent.status).toLowerCase()
  return statusText.includes(filter)
}

export function countTorrents(torrents: Torrent[]) {
  const counts = {
    all: torrents.length,
    active: 0,
    downloading: 0,
    seeding: 0,
    paused: 0,
  }

  torrents.forEach(torrent => {
    if (isActiveTorrent(torrent)) counts.active++
    if (isDownloadingTorrent(torrent)) counts.downloading++
    if (isSeedingTorrent(torrent)) counts.seeding++
    if (isPausedTorrent(torrent)) counts.paused++
  })

  return counts
}

