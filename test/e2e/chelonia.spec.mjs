// The Chelonia half: an account really exists on the relay, the todos really
// go through the KV slot, and two browsers really converge.

import { expect, test } from '@playwright/test'
import { PASSWORD, addTodo, items, login, newUsername, signup, titles } from './helpers.mjs'

test('a session survives a reload', async ({ page }) => {
  await signup(page)
  await addTodo(page, 'survive a reload')

  await page.reload()

  await expect(titles(page)).toHaveText(['survive a reload'])
})

test('logging out clears the browser, logging back in recovers the todos', async ({ page }) => {
  const username = await signup(page)
  await addTodo(page, 'recovered from the contract')

  await page.getByRole('button', { name: 'log out' }).click()
  await expect(page.locator('.auth')).toBeVisible()

  // Nothing local is reused after this point: the keys are decrypted out of
  // the contract using the key derived from the password.
  const saved = await page.evaluate(() => localStorage.getItem('todomvc/chelonia-state'))
  expect(saved).toBeNull()

  await login(page, username)

  await expect(page.locator('.session')).toContainText(username)
  await expect(titles(page)).toHaveText(['recovered from the contract'])
})

// The other tab keeps the whole session in memory with its saving watcher
// still armed, so without the storage listener its next write would put the
// keys back and a reload would be logged in again.
test('logging out in one tab does not let another tab save the session back',
  async ({ context }) => {
    const one = await context.newPage()
    await signup(one)
    await addTodo(one, 'written before logging out')

    const two = await context.newPage()
    await two.goto('/app/')
    await expect(titles(two)).toHaveText(['written before logging out'])

    await one.getByRole('button', { name: 'log out' }).click()
    await expect(one.locator('.auth')).toBeVisible()

    // The second tab drops the session as soon as it sees the key go.
    await expect(two.locator('.auth')).toBeVisible()

    await two.reload()
    await expect(two.locator('.auth')).toBeVisible()
    const saved = await two.evaluate(() => localStorage.getItem('todomvc/chelonia-state'))
    expect(saved).toBeNull()
  })

test('a wrong password and an unknown user look the same', async ({ page }) => {
  const username = await signup(page)
  await page.getByRole('button', { name: 'log out' }).click()

  await login(page, username, 'not-the-right-password')
  await expect(page.locator('.auth-error')).toHaveText('Incorrect username or password.')

  await page.reload()
  await login(page, newUsername())
  await expect(page.locator('.auth-error')).toHaveText('Incorrect username or password.')
})

// A wrong password comes back as a 500 from the zkpp routes, so the two have to
// be told apart by whether the server answered at all.
test('a login that never reaches the server says so', async ({ page }) => {
  const username = await signup(page)
  await page.getByRole('button', { name: 'log out' }).click()

  await page.route('**/name/**', (route) => route.abort('connectionfailed'))
  await login(page, username)

  await expect(page.locator('.auth-error')).toContainText('Could not reach the server')
})

test('a taken username is reported as taken', async ({ page }) => {
  const username = await signup(page)
  await page.getByRole('button', { name: 'log out' }).click()

  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.locator('.auth-error')).toHaveText('That username is already taken.')
})

test('a username the relay would reject is caught before any request', async ({ page }) => {
  await page.goto('/app/')
  await page.getByRole('button', { name: 'Create an account' }).click()

  let requested = false
  await page.route('**/zkpp/**', (route) => { requested = true; route.continue() })

  await page.getByLabel('Username').fill('Alice')
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.locator('.auth-error')).toContainText('lowercase letters')
  expect(requested).toBe(false)
})

test('the list goes read only while the relay is unreachable', async ({ page, context }) => {
  await signup(page)
  await addTodo(page, 'written while connected')

  await context.setOffline(true)

  // Nothing is queued, so a change made now would be lost. The controls are
  // disabled rather than left to fail one by one.
  await expect(page.locator('.todo-notice')).toContainText('read only')
  await expect(page.locator('.new-todo')).toBeDisabled()
  await expect(items(page).first().locator('.toggle')).toBeDisabled()
  await expect(page.locator('.toggle-all input')).toBeDisabled()

  // Reading still works: the list and the filters are untouched.
  await expect(titles(page)).toHaveText(['written while connected'])
  await page.locator('.filters a', { hasText: 'Active' }).click()
  await expect(titles(page)).toHaveText(['written while connected'])

  await context.setOffline(false)

  await expect(page.locator('.todo-notice')).toBeHidden()
  await expect(page.locator('.new-todo')).toBeEnabled()
  await addTodo(page, 'written after reconnecting')
  await expect(titles(page)).toHaveText([
    'written while connected',
    'written after reconnecting'
  ])
})

test('two browsers on the same account converge', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  try {
    const username = await signup(pageOne)
    await pageTwo.goto('/app/')
    await login(pageTwo, username)
    await expect(pageTwo.locator('.session')).toContainText(username)

    // A write in one browser reaches the other over pubsub, with nothing in
    // the UI subscribed to anything.
    await addTodo(pageOne, 'from browser one')
    await expect(titles(pageTwo)).toHaveText(['from browser one'])

    // Force the collision instead of hoping the two writes happen to overlap:
    // hold browser one's write back so browser two's lands first. Browser one
    // is then writing against an etag the relay has already moved past, which
    // is the 409/412 path.
    let writes = 0
    await pageOne.route('**/kv/**', async (route) => {
      if (route.request().method() === 'POST') {
        writes += 1
        if (writes === 1) await new Promise((resolve) => setTimeout(resolve, 500))
      }
      await route.continue()
    })

    await Promise.all([
      addTodo(pageOne, 'racing one'),
      addTodo(pageTwo, 'racing two')
    ])

    await expect.poll(() => titles(pageOne).allTextContents()).toHaveLength(3)
    await expect.poll(() => titles(pageTwo).allTextContents()).toHaveLength(3)

    const [inOne, inTwo] = await Promise.all([
      titles(pageOne).allTextContents(),
      titles(pageTwo).allTextContents()
    ])
    // Converged: same todos, same order. Which of the two racing writes sorts
    // first is not fixed, since they can land on the same millisecond.
    expect(inOne).toEqual(inTwo)
    expect([...inOne].sort()).toEqual(['from browser one', 'racing one', 'racing two'])

    // More than one POST means the rejected write was re-run against the newer
    // value rather than being dropped or overwriting it.
    expect(writes).toBeGreaterThan(1)

    // And a toggle from the second browser lands in the first.
    await pageTwo.locator('.todo-list li').first().locator('.toggle').click()
    await expect(pageOne.locator('.todo-list li').first()).toHaveClass(/completed/)
  } finally {
    await one.close()
    await two.close()
  }
})
