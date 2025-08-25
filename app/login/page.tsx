"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push("/")
      } else {
        setError("Incorrect password, try again.")
      }
    } catch (err) {
      console.error(err)
      setError("Something went wrong.")
    }
  }

  return (
    <main className="flex flex-col items-center justify-center h-screen p-4">
      <div className="max-w-md w-full bg-white shadow rounded p-6">
        <h1 className="text-2xl font-bold mb-4 text-center">League Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="League password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          {error && <p className="text-red-500">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Enter
          </button>
        </form>
      </div>
    </main>
  )
}
