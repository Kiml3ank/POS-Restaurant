# POS Web Application — Admin / Back Office Specification

## Overview

The Admin / Back Office is the management interface for a general-purpose web-based POS system. It is separate from the cashier-facing POS.

Its purpose is to let authorized owners and managers control products, orders, inventory, employees, customers, payments, finances, reports, configuration, and security.

## Main Navigation

```text
Dashboard
POS
Orders
Tables
Products
Categories
Modifiers
Inventory
Suppliers
Purchases
Recipes
Customers
Employees
Roles & Permissions
Shifts
Promotions
Expenses
Payments
Reports
Audit Logs
Notifications
Settings
```

## 1. Dashboard

Display:

- Today's revenue
- Today's orders
- Average order value
- Gross profit
- Expenses
- Estimated net profit
- Active orders
- Refunds
- Discounts
- Low-stock alerts
- Out-of-stock products
- Sales trends
- Top-selling products
- Payment breakdown

Support date filters:

- Today
- This week
- This month
- This year
- Custom range

## 2. POS Monitoring

Admins/managers can:

- View live orders
- View active orders
- View completed orders
- View cancelled orders
- View refunded orders
- Reprint receipts
- View payments
- Cancel/void orders when authorized
- Refund orders when authorized

## 3. Order Management

Search and filter by:

- Order number
- Customer
- Cashier
- Table
- Product
- Date
- Status
- Order type
- Payment method

Order details should include:

```text
Order Number
Date / Time
Customer
Employee
Table
Order Type
Items
Subtotal
Discount
Tax
Service Charge
Total
Payment Method
Payment Status
Created By
Completed By
```

Statuses:

```text
Draft
Open
Preparing
Ready
Completed
Cancelled
Refunded
```

## 4. Product Management

Product fields:

```text
Product ID
Name
SKU
Barcode
Category
Description
Image
Selling Price
Cost Price
Tax
Status
Created Date
Updated Date
```

Actions:

- Create
- Edit
- Duplicate
- Archive
- Restore
- Delete when permitted
- Enable/disable availability

Prefer archiving products with existing sales history instead of permanently deleting them.

## 5. Categories

Support:

- Create
- Edit
- Reorder
- Enable/disable
- Archive

## 6. Variants and Modifiers

Support:

- Product sizes
- Variants
- Modifier groups
- Required/optional modifiers
- Minimum/maximum selections
- Price adjustments

Example:

```text
Coffee
Small     25,000
Medium    30,000
Large     35,000

Extra Milk     +5,000
Extra Syrup    +5,000
```

## 7. Inventory

Support:

- Current stock
- Stock in
- Stock out
- Adjustments
- Waste
- Damage
- Returns
- Transfers
- Inventory history
- Low-stock alerts

Inventory fields:

```text
Item
SKU
Current Quantity
Unit
Minimum Stock
Cost
Supplier
Last Updated
```

## 8. Recipes and Ingredients

Optional advanced feature.

Example:

```text
Iced Coffee
├── Coffee Beans  20g
├── Milk          150ml
├── Syrup          10ml
└── Ice            100g
```

Selling one product can automatically deduct its ingredients from inventory.

## 9. Suppliers and Purchases

Supplier fields:

```text
Supplier Name
Contact Person
Phone
Email
Address
Notes
Status
```

Purchase workflow:

```text
Draft
↓
Ordered
↓
Received
↓
Inventory Updated
```

Purchase records should include supplier, items, quantities, costs, total, dates, and receiving status.

## 10. Tables

For businesses supporting dine-in:

- Create/edit/archive tables
- Set capacity
- Set area/floor
- Move tables
- View table status
- Transfer orders
- Merge tables
- Split bills
- Close tables

Statuses:

```text
Available
Occupied
Reserved
Waiting Payment
Cleaning
Unavailable
```

## 11. Customers

Optional for simple businesses.

Customer profile:

```text
Customer ID
Name
Phone
Email
Address
Notes
```

Display:

- Order history
- Total spending
- Average order value
- Last visit
- Favorite products
- Loyalty points

Customers should not be mandatory for normal walk-in orders.

## 12. Employees

Employee fields:

```text
Employee ID
Name
Username
Phone
Email
Role
Status
Created Date
Last Login
```

Actions:

- Create
- Edit
- Disable
- Reset password
- Reset PIN
- Assign role
- Assign permissions
- View activity

## 13. Roles and Permissions

Use granular permissions such as:

```text
pos.view
pos.create_order
pos.cancel_order
pos.refund
orders.view
products.create
products.edit
products.delete
products.change_price
inventory.view
inventory.adjust
employees.manage
reports.view
settings.manage
```

Roles can include:

```text
Super Admin
Admin
Manager
Cashier
```

Backend APIs must enforce permissions; hiding buttons in the frontend is not sufficient.

## 14. Shifts

Opening shift:

```text
Employee
Start Time
Register
Opening Cash
```

Closing shift:

```text
Opening Cash
+ Cash Sales
- Refunds
= Expected Cash

Actual Cash
Difference
```

Managers should be able to review cash discrepancies.

## 15. Payments

Supported methods can include:

- Cash
- Bank transfer
- Card
- QR payment
- E-wallet
- Other

Payment record:

```text
Payment ID
Order ID
Amount
Payment Method
Status
Transaction Reference
Processed By
Date / Time
```

Statuses:

```text
Pending
Paid
Failed
Refunded
Partially Refunded
```

## 16. Expenses

Record:

- Rent
- Electricity
- Water
- Salaries
- Marketing
- Maintenance
- Equipment
- Supplies
- Other expenses

Fields:

```text
Expense ID
Category
Amount
Date
Description
Payment Method
Created By
Attachment
```

## 17. Promotions and Discounts

Support:

- Percentage discounts
- Fixed discounts
- Product discounts
- Category discounts
- Buy-one-get-one
- Time-based promotions
- Customer-specific promotions

Promotion fields:

```text
Name
Type
Value
Start Date
End Date
Products
Categories
Minimum Order
Maximum Discount
Usage Limit
Eligibility
Status
```

Discount limits should depend on permissions.

## 18. Reports

### Sales

- Revenue
- Orders
- Average order value
- Items sold
- Sales by day
- Sales by hour

### Products

- Best sellers
- Worst sellers
- Quantity sold
- Revenue
- Estimated profit

### Employees

- Sales per employee
- Orders
- Discounts
- Refunds

### Payments

- Cash
- Card
- Bank transfer
- QR
- Other

### Inventory

- Current stock
- Stock movement
- Low stock
- Waste
- Purchases

### Financial

```text
Revenue
- Product Cost
- Expenses
- Discounts
- Refunds
----------------
Estimated Net Profit
```

## 19. Report Export

Support:

- CSV
- Excel
- PDF

Allow filters by date, category, employee, payment method, and other relevant dimensions.

## 20. Audit Logs

Record important actions:

```text
User
Action
Resource
Resource ID
Old Value
New Value
Date / Time
IP Address when appropriate
```

Examples:

```text
Admin changed product price
Manager approved refund
Cashier cancelled order
Manager adjusted inventory
Admin changed employee role
```

Audit logs should be append-only for normal users.

## 21. Notifications

Examples:

- Low stock
- Out of stock
- Large refund
- Cash discrepancy
- New purchase received
- Failed payment
- System error

Support read/unread status, priority, timestamp, and related resource.

## 22. Settings

### Business

- Business name
- Logo
- Address
- Phone
- Email
- Currency
- Timezone
- Language

### POS

- Order numbering
- Default order type
- Receipt settings
- Tax
- Service charge
- Discount rules

### Payments

- Enabled payment methods
- Payment provider configuration

### Inventory

- Automatic stock deduction
- Negative stock rules
- Low-stock thresholds

### Security

- Session timeout
- Password policy
- PIN policy
- Login attempt limits

## 23. Receipt and Hardware

Receipt configuration:

- Business information
- Logo
- Tax information
- Footer
- Order number format
- Printer

Optional hardware:

- Receipt printer
- Kitchen printer
- Cash drawer
- Barcode scanner
- Customer display
- Kitchen Display System

## 24. Kitchen / KDS

Optional advanced module.

```text
Order Created
↓
Kitchen
↓
Preparing
↓
Ready
↓
Served
```

Admin can configure kitchen stations, categories, routing, printers, and kitchen users.

## 25. Backup and Data Management

Support:

- Database backups
- Backup history
- Data export
- Restore procedures
- Backup status
- Data retention

Automatic backups are recommended for production deployments.

## 26. Security

Implement:

- Secure authentication
- Password hashing
- Session management
- Role-based access control
- Server-side authorization
- Input validation
- Rate limiting
- Secure API endpoints
- Audit logs
- Secure file uploads
- HTTPS in production

Never store plain-text passwords.

## 27. UX Principles

The Admin panel should:

- Use clear navigation
- Use consistent tables/forms/modals
- Provide search and filters
- Use pagination for large datasets
- Confirm dangerous actions
- Warn about unsaved changes
- Show clear success/error messages
- Avoid unnecessary animations
- Prioritize actionable information

## 28. Recommended Page Pattern

```text
Page Header
├── Title
├── Description
└── Primary Action

Filters
├── Search
├── Date Range
├── Status
└── Other Filters

Main Content
└── Table / Cards

Pagination

Details / Edit Drawer or Page
```

## 29. MVP Admin Scope

### Phase 1 — Essential

```text
Authentication
Dashboard
Products
Categories
Orders
Employees
Roles & Permissions
Basic Inventory
Payments
Basic Reports
Settings
Audit Logs
```

### Phase 2 — Business Management

```text
Tables
Suppliers
Purchases
Expenses
Promotions
Shifts
Customers
Report Export
```

### Phase 3 — Advanced

```text
Recipes
Automatic Ingredient Deduction
Loyalty
Kitchen Display System
Hardware Integration
Advanced Analytics
Multi-branch
Cloud Synchronization
External Integrations
Automation
```

## 30. Architecture

The POS and Admin panel should use the same backend and business rules while providing different interfaces and permissions.

```text
                    BACKEND / API
                         │
          ┌──────────────┴──────────────┐
          │                             │
       POS APP                     ADMIN APP
          │                             │
      Cashiers                  Admin / Manager
          │                             │
          └──────────────┬──────────────┘
                         │
                      DATABASE
```

### POS focuses on

```text
Speed
Orders
Payments
Tables
Receipts
```

### Admin focuses on

```text
Control
Management
Inventory
Employees
Finance
Reports
Configuration
Security
```

## 31. Definition of Done

The Admin MVP is complete when an authorized administrator can:

- Log in securely
- View the business dashboard
- Create/edit/archive products
- Manage categories
- View and manage orders
- View payment records
- Manage employees
- Assign roles and permissions
- View and adjust inventory
- View basic reports
- Configure business settings
- Review audit logs

The Admin panel should be capable of managing the core POS operation without requiring direct database manipulation.
