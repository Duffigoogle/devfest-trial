#!/bin/bash
set -e
set -u

function create_user_and_database() {
  local database=$1
  local user=$2
  local password=$3
  echo "Creating isolated user '$user' and database '$database'..."
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER $user WITH PASSWORD '$password' CONNECTION LIMIT 30;
    CREATE DATABASE $database OWNER $user;
    REVOKE ALL ON DATABASE $database FROM PUBLIC;
    GRANT ALL PRIVILEGES ON DATABASE $database TO $user;
EOSQL
}

# Provision the 5 isolated logical databases following the Database-per-Service strategy
create_user_and_database "product_db" "svc_product" "product_secret_local"
create_user_and_database "cart_db" "svc_cart" "cart_secret_local"
create_user_and_database "order_db" "svc_order" "order_secret_local"
create_user_and_database "payment_db" "svc_payment" "payment_secret_local"
create_user_and_database "notification_db" "svc_notification" "notification_secret_local"
