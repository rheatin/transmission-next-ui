import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { I18nProvider } from "@/lib/i18n-context"
import { CreateTorrentDialog } from "./create-torrent-dialog"

const rpcMock = vi.hoisted(() => ({
  freeSpace: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/lib/rpc-client", () => ({ rpc: rpcMock }))

describe("CreateTorrentDialog path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem("transmission-locale", "zh")
    rpcMock.getSession.mockResolvedValue({ "download-dir": "/share/NAS/Downloads" })
    rpcMock.freeSpace.mockResolvedValue({ "size-bytes": 1024 ** 4, total_size: 2 * 1024 ** 4 })
  })

  test("validates the manually entered path through Transmission free-space RPC", async () => {
    render(
      <I18nProvider>
        <CreateTorrentDialog>
          <button type="button">Open</button>
        </CreateTorrentDialog>
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    const pathInput = await screen.findByLabelText("容器内源路径")
    fireEvent.change(pathInput, { target: { value: "/share/NAS/Downloads/Movies" } })
    fireEvent.click(screen.getByRole("button", { name: "验证路径" }))

    await waitFor(() => {
      expect(rpcMock.freeSpace).toHaveBeenCalledWith("/share/NAS/Downloads/Movies")
    })
    expect(await screen.findByText(/路径可访问/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "生成种子" })).toBeEnabled()
  })

  test("shows an error when Transmission cannot access the path", async () => {
    rpcMock.freeSpace.mockRejectedValue(new Error("No such file or directory"))
    render(
      <I18nProvider>
        <CreateTorrentDialog>
          <button type="button">Open</button>
        </CreateTorrentDialog>
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    const pathInput = await screen.findByLabelText("容器内源路径")
    fireEvent.change(pathInput, { target: { value: "/share/missing" } })
    fireEvent.click(screen.getByRole("button", { name: "验证路径" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("路径验证失败")
    expect(screen.getByRole("button", { name: "生成种子" })).toBeDisabled()
  })
})