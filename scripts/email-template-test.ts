import { buildOnboardingEmail, buildMaintenanceUpdateEmail, buildBroadcastEmail } from '../src/lib/emailTemplates';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

// --- Onboarding email ---
{
  const email = buildOnboardingEmail('Jane Doe', 'ABC123', 'Lana');
  check('onboarding subject mentions PropertyWorks', email.subject.includes('PropertyWorks'));
  check('onboarding body contains tenant name', email.html.includes('Jane Doe'));
  check('onboarding body contains the invite code', email.html.includes('ABC123'));
  check('onboarding body contains the app link', email.html.includes('https://jjdia.github.io/propworks'));
  check('onboarding body mentions Add to Home Screen', email.html.includes('Add to Home Screen'));
  check('onboarding body names the owner', email.html.includes('Lana'));
}

// --- Maintenance update email ---
{
  const approved = buildMaintenanceUpdateEmail('Jane Doe', 'Leaking faucet', 'approved_for_bidding');
  const awarded = buildMaintenanceUpdateEmail('Jane Doe', 'Leaking faucet', 'awarded');
  const rejected = buildMaintenanceUpdateEmail('Jane Doe', 'Leaking faucet', 'rejected');
  check('maintenance subject includes the request title', approved.subject.includes('Leaking faucet'));
  check('approved status produces a distinct message from awarded', approved.html !== awarded.html);
  check('rejected status mentions contacting the property manager', rejected.html.toLowerCase().includes('contact your property manager'));
  check('unknown status falls back gracefully instead of crashing', buildMaintenanceUpdateEmail('Jane', 'X', 'some_future_status').html.includes('some_future_status'));
}

// --- Broadcast email ---
{
  const email = buildBroadcastEmail('Jane Doe', 'Pest control Tuesday', "We'll have an exterminator on site.\nPlease keep pets secured.");
  check('broadcast uses the exact subject the owner typed', email.subject === 'Pest control Tuesday');
  check('broadcast body includes tenant name', email.html.includes('Jane Doe'));
  check('broadcast body converts newlines to <br/>', email.html.includes('<br/>'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
