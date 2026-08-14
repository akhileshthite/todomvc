import { expect } from '@playwright/test'

export const PASSWORD = 'todomvc-e2e-password'

let counter = 0

// chel's NAME_REGEX allows lowercase letters, digits, hyphen and underscore,
// and no repeated separator. Every test makes its own account so one test
// cannot see another's todos.
export const newUsername = () =>
  `e2e-${Date.now().toString(36)}-${(counter++).toString(36)}`

export async function signup (page, username = newUsername()) {
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.locator('.session')).toContainText(username)
  return username
}

export async function login (page, username, password = PASSWORD) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

export async function addTodo (page, title) {
  const input = page.locator('.new-todo')
  await input.fill(title)
  await input.press('Enter')
}

export const titles = (page) => page.locator('.todo-list li label')
export const items = (page) => page.locator('.todo-list li')
