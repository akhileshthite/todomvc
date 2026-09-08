// Sharing a list with another account. Two real accounts, one list contract,
// an invite, and the key request the owner's browser has to answer.

import { expect, test } from '@playwright/test'
import { addTodo, inviteLink, items, newUsername, signup, titles } from './helpers.mjs'

const tabs = (page) => page.locator('.list-tabs button')

test('a second account joins a list and both edit it', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const guest = await guestContext.newPage()

  try {
    await signup(owner)
    await addTodo(owner, 'from the owner')

    const link = await inviteLink(owner)
    expect(link).toContain('#/join?list=')
    // The secret is in the fragment, which browsers never send to the server.
    expect(new URL(link).search).toBe('')
    // Sharing twice reuses the invite already on the contract instead of
    // leaving a spare key on it.
    expect(await inviteLink(owner)).toBe(link)

    await guest.goto('/app/')
    await signup(guest)
    await guest.goto(link)

    await expect(guest.locator('.join')).toContainText('shared a todo list with you')
    await guest.getByRole('button', { name: 'Join the list' }).click()

    // The owner's browser answers the key request. Nothing on the server can.
    await expect(tabs(guest)).toHaveText(['My todos', 'My todos'])
    await expect(titles(guest)).toHaveText(['from the owner'])

    // Both are now writing the same KV slot on the same contract.
    await addTodo(guest, 'from the guest')
    await expect(titles(owner)).toHaveText(['from the owner', 'from the guest'])

    await owner.locator('.todo-list li').first().locator('.toggle').click()
    await expect(items(guest).first()).toHaveClass(/completed/)
  } finally {
    await ownerContext.close()
    await guestContext.close()
  }
})

test('the list title is an action, so a rename reaches the other account', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const guest = await guestContext.newPage()

  try {
    await signup(owner)
    const link = await inviteLink(owner)

    await guest.goto('/app/')
    await signup(guest)
    await guest.goto(link)
    await guest.getByRole('button', { name: 'Join the list' }).click()
    await expect(tabs(guest)).toHaveCount(2)

    await tabs(owner).first().dblclick()
    await owner.locator('.list-rename').fill('groceries')
    await owner.locator('.list-rename').press('Enter')

    await expect(tabs(owner)).toHaveText(['groceries'])
    await expect(tabs(guest)).toHaveText(['My todos', 'groceries'])
  } finally {
    await ownerContext.close()
    await guestContext.close()
  }
})

test('a joined list survives logging out and back in', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const guest = await guestContext.newPage()

  try {
    await signup(owner)
    await addTodo(owner, 'shared before the guest logged out')
    const link = await inviteLink(owner)

    await guest.goto('/app/')
    const username = await signup(guest)
    await guest.goto(link)
    await guest.getByRole('button', { name: 'Join the list' }).click()
    await expect(tabs(guest)).toHaveCount(2)

    await guest.getByRole('button', { name: 'log out' }).click()
    await expect(guest.locator('.auth')).toBeVisible()

    // Nothing local is reused. The list's keys come back out of the guest's own
    // identity contract, where the owner's OP_KEY_SHARE put them.
    await guest.getByLabel('Username').fill(username)
    await guest.getByLabel('Password').fill('todomvc-e2e-password')
    await guest.getByRole('button', { name: 'Log in' }).click()

    await expect(tabs(guest)).toHaveCount(2)
    await tabs(guest).nth(1).click()
    await expect(titles(guest)).toHaveText(['shared before the guest logged out'])
  } finally {
    await ownerContext.close()
    await guestContext.close()
  }
})

test('a joined list is read only until the owner answers', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const guest = await guestContext.newPage()

  try {
    await signup(owner)
    const link = await inviteLink(owner)
    // Offline, so the request is published but never answered.
    await ownerContext.setOffline(true)

    await guest.goto('/app/')
    await signup(guest)
    await guest.goto(link)
    await guest.getByRole('button', { name: 'Join the list' }).click()

    await expect(guest.locator('.list-pending')).toContainText('Waiting')
    await expect(guest.locator('.todos')).toBeHidden()

    // Reloading while the answer is still outstanding does not re-send the
    // request, and the answer is picked up whenever it comes.
    await guest.reload()
    await tabs(guest).nth(1).click()
    await expect(guest.locator('.list-pending')).toContainText('Waiting')

    await ownerContext.setOffline(false)
    await expect(guest.locator('.list-pending')).toBeHidden()
    await addTodo(guest, 'written once the keys arrived')
    await expect(titles(owner)).toHaveText(['written once the keys arrived'])
  } finally {
    await ownerContext.close()
    await guestContext.close()
  }
})

test('an invite is good once', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()

  try {
    await signup(owner)
    const link = await inviteLink(owner)

    await first.goto('/app/')
    await signup(first)
    await first.goto(link)
    await first.getByRole('button', { name: 'Join the list' }).click()
    await expect(tabs(first)).toHaveCount(2)

    await second.goto('/app/')
    await signup(second)
    await second.goto(link)
    await second.getByRole('button', { name: 'Join the list' }).click()

    // The request is published, so the list shows up, but the invite key is
    // spent and the owner's browser refuses to answer this one.
    await expect(second.locator('.list-pending')).toContainText('Waiting')

    // Not a race with a slow answer: the owner is online and answering, which
    // this proves by reaching the guest who did get in.
    await addTodo(owner, 'the owner is still here')
    await expect(titles(first)).toHaveText(['the owner is still here'])
    await expect(second.locator('.list-pending')).toContainText('Waiting')
  } finally {
    await ownerContext.close()
    await firstContext.close()
    await secondContext.close()
  }
})

test('declining an invite leaves the current list selected', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  const guest = await guestContext.newPage()

  try {
    await signup(owner)
    const link = await inviteLink(owner)

    await guest.goto('/app/')
    await signup(guest)
    await addTodo(guest, 'my own todo')
    await guest.goto(link)
    await guest.getByRole('button', { name: 'No thanks' }).click()

    // Back on the guest's own list, not on a waiting screen.
    await expect(tabs(guest)).toHaveText(['My todos'])
    await expect(guest.locator('.list-pending')).toBeHidden()
    await expect(titles(guest)).toHaveText(['my own todo'])
  } finally {
    await ownerContext.close()
    await guestContext.close()
  }
})

test('an account with no lists starts with none and can make one', async ({ page }) => {
  await signup(page, newUsername())

  await page.locator('.list-new input').fill('weekend')
  await page.getByRole('button', { name: 'Add list' }).click()

  await expect(tabs(page)).toHaveText(['My todos', 'weekend'])
  await addTodo(page, 'only on the second list')
  await expect(titles(page)).toHaveText(['only on the second list'])

  // Two lists, two contracts, two slots: switching back shows the other one
  // empty rather than the same todos twice.
  await tabs(page).first().click()
  await expect(page.locator('.todo-list')).toBeHidden()
})
