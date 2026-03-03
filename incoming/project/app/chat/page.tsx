"use client"

import { useState, useRef, useCallback } from "react"
import Link from "next/link"
import { Terminal, ArrowLeft, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelSelector, type ModelId } from "@/components/model-selector"
import { ChatMessages } from "@/components/chat-messages"
import { ChatInput } from "@/components/chat-input"
import type { UIMessage } from "ai"

export default function ChatPage() {
  const [model, setModel] = useState<ModelId>("llama-3.3-70b-versatile")
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<"ready" | "streaming" | "error">("ready")
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || status === "streaming") return

      setError(null)

      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      }

      const assistantMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: "" }],
      }

      const updatedMessages = [...messages, userMessage]
      setMessages([...updatedMessages, assistantMessage])
      setStatus("streaming")

      abortRef.current = new AbortController()

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: updatedMessages, model }),
          signal: abortRef.current.signal,
        })

        if (!res.ok) {
          const errData = await res.text()
          throw new Error(errData || "Request failed")
        }

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let fullText = ""
        let pendingLine = ""

        const processLine = (line: string) => {
          if (!line.trim()) return

          // AI SDK data stream format: `0:"text chunk"\n`
          const match = line.match(/^0:(.+)$/)
          if (!match) return

          try {
            const parsed = JSON.parse(match[1])
            if (typeof parsed === "string") {
              fullText += parsed
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    parts: [{ type: "text", text: fullText }],
                  }
                }
                return updated
              })
            }
          } catch {
            // skip unparseable lines
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = pendingLine + decoder.decode(value, { stream: true })
          const lines = chunk.split("\n")
          pendingLine = lines.pop() ?? ""

          for (const line of lines) processLine(line)
        }

        processLine(pendingLine)

        setStatus("ready")
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("ready")
          return
        }
        console.error("[v0] Chat error:", err)
        setError("Something went wrong. Please try again.")
        setStatus("error")
      }
    },
    [messages, model, status]
  )

  const isLoading = status === "streaming"

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Back to home"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Terminal className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold text-foreground">
              CheatFactory
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                abortRef.current?.abort()
                setMessages([])
                setStatus("ready")
                setError(null)
              }}
              aria-label="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Messages */}
      <ChatMessages messages={messages} isLoading={isLoading} />

      {/* Error */}
      {error && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={(text) => sendMessage(text)}
        isLoading={isLoading}
      />
    </div>
  )
}
