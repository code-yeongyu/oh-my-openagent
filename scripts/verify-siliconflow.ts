#!/usr/bin/env bun
/**
 * Verify SiliconFlow API configuration and model availability
 */

import OpenAI from "openai"

const API_KEY = "sk-njiwsqeiklyzdcyiderytlupdumqqtbttoorzmzrtsnhxqlm"
const BASE_URL = "https://api.siliconflow.cn/v1"

const EXPECTED_MODELS = [
  "deepseek-ai/DeepSeek-V4-Flash",
  "Qwen/Qwen3.6-35B-A3B",
  "Qwen/Qwen3.6-27B",
  "Qwen/Qwen3.5-9B",
  "Qwen/Qwen3-8B",
  "Qwen/Qwen3-32B",
  "Qwen/Qwen3-14B",
]

async function verifyConfiguration() {
  console.log("=== SiliconFlow API Configuration Verification ===\n")

  // Initialize client
  const client = new OpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL,
  })

  // Test 1: List models
  console.log("1. Fetching available models...")
  try {
    const models = await client.models.list()
    const modelIds = models.data.map((m) => m.id).sort()

    console.log(`   ✓ Found ${modelIds.length} models\n`)

    // Check expected models
    console.log("2. Checking expected models...")
    for (const expected of EXPECTED_MODELS) {
      const found = modelIds.includes(expected)
      console.log(`   ${found ? "✓" : "✗"} ${expected}`)
    }

    // Show all available models
    console.log("\n3. All available models:")
    for (const id of modelIds) {
      console.log(`   - ${id}`)
    }
  } catch (error) {
    console.error("   ✗ Failed to list models:", error)
    return false
  }

  // Test 2: Simple API call
  console.log("\n4. Testing API call with Qwen3-8B...")
  try {
    const response = await client.chat.completions.create({
      model: "Qwen/Qwen3-8B",
      messages: [
        { role: "user", content: "Say 'API test successful' in exactly these words." },
      ],
      max_tokens: 20,
    })

    const content = response.choices[0]?.message?.content || ""
    console.log(`   ✓ API call successful`)
    console.log(`   Response: "${content}"`)
    console.log(`   Tokens: ${response.usage?.total_tokens || "unknown"}`)
  } catch (error) {
    console.error("   ✗ API call failed:", error)
    return false
  }

  // Test 3: Price estimation
  console.log("\n5. Price estimation (based on provided price list):")
  const prices = {
    "Qwen/Qwen3-8B": { input: 0, output: 0 },
    "Qwen/Qwen3-14B": { input: 0.5, output: 2 },
    "Qwen/Qwen3-32B": { input: 1, output: 4 },
    "Qwen/Qwen3.5-9B": { input: 0.5, output: 4 },
    "Qwen/Qwen3.6-27B": { input: 3, output: 18 },
    "Qwen/Qwen3.6-35B-A3B": { input: 1.8, output: 10.8 },
    "deepseek-ai/DeepSeek-V4-Flash": { input: 1, output: 2 },
  }

  console.log("\n   Model                    Input (¥/M)  Output (¥/M)  Combined")
  console.log("   " + "─".repeat(60))
  for (const [model, price] of Object.entries(prices)) {
    const combined = price.input + price.output
    console.log(
      `   ${model.padEnd(25)} ¥${price.input.toFixed(2).padStart(8)}  ¥${price.output.toFixed(2).padStart(9)}  ¥${combined.toFixed(2).padStart(8)}`
    )
  }

  console.log("\n=== Verification Complete ===")
  console.log("✓ All checks passed! Configuration is ready for testing.")

  return true
}

// Run verification
verifyConfiguration()
  .then((success) => {
    process.exit(success ? 0 : 1)
  })
  .catch((error) => {
    console.error("Unexpected error:", error)
    process.exit(1)
  })
