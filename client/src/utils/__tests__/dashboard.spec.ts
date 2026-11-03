import { dashboardHomeUrl } from '../dashboard';

describe('dashboardHomeUrl', () => {
  it.each([
    [
      'https://chat.staging.example.test/dashboard/auth/callback',
      'https://chat.staging.example.test/dashboard/',
    ],
    ['https://dash.example.test/auth/callback', 'https://dash.example.test/'],
    ['http://localhost:5273/dashboard/auth/callback', 'http://localhost:5273/dashboard/'],
  ])('maps %s to the dashboard home %s', (callback, home) => {
    expect(dashboardHomeUrl(callback)).toBe(home);
  });

  it.each([
    undefined,
    '',
    'http://chat.example.test/dashboard/auth/callback',
    'https://user:pw@chat.example.test/dashboard/auth/callback',
    'https://chat.example.test/dashboard/auth/callback?x=1',
    'https://chat.example.test/dashboard/elsewhere',
    'javascript:alert(1)',
  ])('refuses %j', (value) => {
    expect(dashboardHomeUrl(value)).toBeUndefined();
  });
});
