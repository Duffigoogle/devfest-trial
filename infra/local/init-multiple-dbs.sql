-- CloudMart PostgreSQL Database-per-Service Initialization Script
-- Enforces strict logical isolation with dedicated roles and zero cross-database privileges.

CREATE ROLE svc_product WITH LOGIN PASSWORD 'product_secret_local' CONNECTION LIMIT 30;
CREATE DATABASE product_db OWNER svc_product;
REVOKE CONNECT ON DATABASE product_db FROM PUBLIC;
GRANT CONNECT, ALL PRIVILEGES ON DATABASE product_db TO svc_product;

CREATE ROLE svc_cart WITH LOGIN PASSWORD 'cart_secret_local' CONNECTION LIMIT 30;
CREATE DATABASE cart_db OWNER svc_cart;
REVOKE CONNECT ON DATABASE cart_db FROM PUBLIC;
GRANT CONNECT, ALL PRIVILEGES ON DATABASE cart_db TO svc_cart;

CREATE ROLE svc_order WITH LOGIN PASSWORD 'order_secret_local' CONNECTION LIMIT 30;
CREATE DATABASE order_db OWNER svc_order;
REVOKE CONNECT ON DATABASE order_db FROM PUBLIC;
GRANT CONNECT, ALL PRIVILEGES ON DATABASE order_db TO svc_order;

CREATE ROLE svc_payment WITH LOGIN PASSWORD 'payment_secret_local' CONNECTION LIMIT 30;
CREATE DATABASE payment_db OWNER svc_payment;
REVOKE CONNECT ON DATABASE payment_db FROM PUBLIC;
GRANT CONNECT, ALL PRIVILEGES ON DATABASE payment_db TO svc_payment;

CREATE ROLE svc_notification WITH LOGIN PASSWORD 'notification_secret_local' CONNECTION LIMIT 30;
CREATE DATABASE notification_db OWNER svc_notification;
REVOKE CONNECT ON DATABASE notification_db FROM PUBLIC;
GRANT CONNECT, ALL PRIVILEGES ON DATABASE notification_db TO svc_notification;
