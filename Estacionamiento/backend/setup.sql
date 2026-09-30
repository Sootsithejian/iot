CREATE DATABASE IF NOT EXISTS parking CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'parking_user'@'localhost' IDENTIFIED BY 'parking_pass_123';
GRANT ALL PRIVILEGES ON parking.* TO 'parking_user'@'localhost';