/**
 * Ralph Loop Test File
 * 
 * This file was created by Ralph Loop to verify the hook is working correctly.
 * Created: 2026-01-24
 */

export function helloRalphLoop(): string {
  return "Hello from Ralph Loop! 🔄"
}

export function add(a: number, b: number): number {
  return a + b
}

// Simple test - Updated for tdd-guard hook test after /tdd on
console.log(helloRalphLoop())
console.log(`2 + 3 = ${add(2, 3)}`)
