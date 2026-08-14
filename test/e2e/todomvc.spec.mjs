// The TodoMVC functional requirements, checked against a running app.
// https://github.com/tastejs/todomvc/blob/master/app-spec.md

import { expect, test } from '@playwright/test'
import { addTodo, items, signup, titles } from './helpers.mjs'

test.beforeEach(async ({ page }) => {
  await signup(page)
})

test('no todos hides the list and the footer, and focuses the input', async ({ page }) => {
  // The spec asks for autofocus on load. The attribute alone does not do it
  // here, because this component mounts after Chelonia has started.
  await expect(page.locator('.new-todo')).toBeFocused()
  await expect(page.locator('.todo-list')).toBeHidden()
  await expect(page.locator('.todo-footer')).toBeHidden()
  await expect(page.locator('.toggle-all')).toBeHidden()

  await addTodo(page, 'now there is one')

  await expect(page.locator('.todo-list')).toBeVisible()
  await expect(page.locator('.todo-footer')).toBeVisible()
})

test('new todos are trimmed, empty input is ignored, and the field clears', async ({ page }) => {
  await addTodo(page, '   ')
  await expect(items(page)).toHaveCount(0)

  await addTodo(page, '   trimmed on the way in   ')

  await expect(titles(page)).toHaveText(['trimmed on the way in'])
  await expect(page.locator('.new-todo')).toHaveValue('')
})

test('toggling items updates the class, the counter and toggle-all', async ({ page }) => {
  await addTodo(page, 'first')
  await addTodo(page, 'second')
  await expect(page.locator('.todo-count')).toHaveText('2 items left')
  await expect(page.locator('.todo-count strong')).toHaveText('2')

  await items(page).first().locator('.toggle').click()

  await expect(items(page).first()).toHaveClass(/completed/)
  await expect(page.locator('.todo-count')).toHaveText('1 item left')
  await expect(page.locator('.toggle-all input')).not.toBeChecked()

  // Toggle all sets every todo to its own state, and reflects "all complete".
  await page.locator('.toggle-all input').click()
  await expect(items(page).filter({ has: page.locator('.toggle:checked') })).toHaveCount(2)
  await expect(page.locator('.todo-count')).toHaveText('0 items left')
  await expect(page.locator('.toggle-all input')).toBeChecked()
})

test('clear completed appears only with completed todos and leaves the rest', async ({ page }) => {
  await addTodo(page, 'keep me')
  await addTodo(page, 'clear me')
  await expect(page.locator('.clear-completed')).toBeHidden()

  await items(page).nth(1).locator('.toggle').click()
  await expect(page.locator('.clear-completed')).toBeVisible()

  await page.locator('.clear-completed').click()

  await expect(titles(page)).toHaveText(['keep me'])
  // Everything left is active again, so toggle-all goes back to unchecked.
  await expect(page.locator('.toggle-all input')).not.toBeChecked()
})

test('editing saves on enter and blur, discards on escape, and destroys when emptied', async ({ page }) => {
  await addTodo(page, 'original')

  const row = items(page).first()
  await row.locator('label').dblclick()
  await expect(row).toHaveClass(/editing/)
  await expect(row.locator('.view')).toBeHidden()
  await expect(page.locator('.edit')).toBeFocused()
  await expect(page.locator('.edit')).toHaveValue('original')

  // Escape leaves the edit without saving.
  await page.locator('.edit').fill('thrown away')
  await page.locator('.edit').press('Escape')
  await expect(row).not.toHaveClass(/editing/)
  await expect(titles(page)).toHaveText(['original'])

  // Enter saves, trimmed.
  await row.locator('label').dblclick()
  await page.locator('.edit').fill('   renamed with spaces   ')
  await page.locator('.edit').press('Enter')
  await expect(titles(page)).toHaveText(['renamed with spaces'])

  // Blur saves too.
  await row.locator('label').dblclick()
  await page.locator('.edit').fill('renamed again')
  await page.locator('.edit').blur()
  await expect(titles(page)).toHaveText(['renamed again'])

  // An empty title destroys the todo.
  await row.locator('label').dblclick()
  await page.locator('.edit').fill('  ')
  await page.locator('.edit').press('Enter')
  await expect(items(page)).toHaveCount(0)
})

test('destroy is revealed on hover and removes the todo', async ({ page }) => {
  await addTodo(page, 'delete me')
  await addTodo(page, 'keep me')

  const row = items(page).first()
  await expect(row.locator('.destroy')).toBeHidden()

  await row.hover()
  await expect(row.locator('.destroy')).toBeVisible()
  await row.locator('.destroy').click()

  await expect(titles(page)).toHaveText(['keep me'])
})

test('routes filter the list and survive a reload', async ({ page }) => {
  await addTodo(page, 'active one')
  await addTodo(page, 'completed one')
  await items(page).nth(1).locator('.toggle').click()

  await page.locator('.filters a', { hasText: 'Active' }).click()
  await expect(titles(page)).toHaveText(['active one'])
  await expect(page.locator('.filters a', { hasText: 'Active' })).toHaveClass(/selected/)

  await page.locator('.filters a', { hasText: 'Completed' }).click()
  await expect(titles(page)).toHaveText(['completed one'])

  await page.reload()

  await expect(titles(page)).toHaveText(['completed one'])
  await expect(page.locator('.filters a', { hasText: 'Completed' })).toHaveClass(/selected/)

  await page.locator('.filters a', { hasText: 'All' }).click()
  await expect(titles(page)).toHaveText(['active one', 'completed one'])
})
