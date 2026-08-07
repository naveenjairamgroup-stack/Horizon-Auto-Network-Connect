#!/usr/bin/env python3
"""
build.py
Assembles index.html from the page fragments in pages/. This is a LOCAL
convenience script only — Cloudflare Pages does not run it, and does not
need to; it just serves whatever index.html is already committed. Run this
yourself after editing any file under pages/, then commit the regenerated
index.html alongside your change.

Usage (from the frontend/ directory):
    python3 build.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, 'pages')


def read(name):
    with open(os.path.join(PAGES, name), encoding='utf-8') as f:
        return f.read()


def main():
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Horizon Auto \u2014 Network Connect</title>
  <link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>
  <div id="login-section">
%(login)s
  </div>

  <div id="main-section" style="display:none;">
%(navbar)s
    <div class="layout">
%(sidebar)s
      <div class="content">
        <div id="page-Dashboard_Admin" class="page">
%(dashboard_admin)s
        </div>
        <div id="page-Dashboard_NetworkManager" class="page">
%(dashboard_nm)s
        </div>
        <div id="page-Dashboard_Accounts" class="page">
%(dashboard_accounts)s
        </div>
        <div id="page-Dashboard_Dealer" class="page">
%(dashboard_dealer)s
        </div>
        <div id="page-DealerMaster" class="page">
%(dealer_master)s
        </div>
        <div id="page-UserMaster" class="page">
%(user_master)s
        </div>
        <div id="page-Ledger" class="page">
%(ledger)s
        </div>
        <div id="page-Payments" class="page">
%(payments)s
        </div>
        <div id="page-Returns" class="page">
%(returns)s
        </div>
        <div id="page-Commission" class="page">
%(commission)s
        </div>
        <div id="page-AuditLog" class="page">
%(audit_log)s
        </div>
        <div id="page-VehicleSaleReview" class="page">
%(vehicle_sale_review)s
        </div>
        <div id="page-PartsReview" class="page">
%(parts_review)s
        </div>
        <div id="page-Imports" class="page">
%(imports)s
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script type="module" src="assets/js/app.js"></script>
</body>
</html>
""" % {
        'login': read('login.html'),
        'navbar': read('navbar.html'),
        'sidebar': read('sidebar.html'),
        'dashboard_admin': read('dashboard-admin.html'),
        'dashboard_nm': read('dashboard-networkmanager.html'),
        'dashboard_accounts': read('dashboard-accounts.html'),
        'dashboard_dealer': read('dashboard-dealer.html'),
        'dealer_master': read('dealer-master.html'),
        'user_master': read('user-master.html'),
        'ledger': read('ledger.html'),
        'payments': read('payments.html'),
        'returns': read('returns.html'),
        'commission': read('commission.html'),
        'audit_log': read('audit-log.html'),
        'vehicle_sale_review': read('vehicle-sale-review.html'),
        'parts_review': read('parts-review.html'),
        'imports': read('imports.html'),
    }

    out_path = os.path.join(HERE, 'index.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('Wrote', out_path, '(%d bytes)' % len(html))


if __name__ == '__main__':
    main()
