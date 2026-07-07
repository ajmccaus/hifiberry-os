################################################################################
#
# raspi-wifi
#
################################################################################

define RASPI_WIFI_BUILD_CMDS
endef

define RASPI_WIFI_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/hostapd.conf \
		$(TARGET_DIR)/etc/tempap-hostapd.conf
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/dnsmasq.conf \
		$(TARGET_DIR)/etc/tempap-dnsmasq.conf
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/wpa_supplicant.conf \
		$(TARGET_DIR)/etc/wpa_supplicant.conf
	# Disable stub resolver in systemd resolved
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/resolved.conf \
		$(TARGET_DIR)/etc/systemd/resolved.conf
	# Headless WiFi provisioning: pick up wpa_supplicant.conf/systemname
	# that the user dropped on the FAT partition
	$(INSTALL) -D -m 0755 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/copy-config \
		$(TARGET_DIR)/opt/hifiberry/bin/copy-config
endef

define RASPI_WIFI_INSTALL_INIT_SYSTEMD
	$(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/wireless.network \
		$(TARGET_DIR)/etc/systemd/network/wireless.network
	$(INSTALL) -D -m 0444 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/wpa_supplicant@wlan0.service \
		$(TARGET_DIR)/usr/lib/systemd/system/wpa_supplicant@wlan0.service
	$(INSTALL) -D -m 0444 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/tempap-dnsmasq.service \
		$(TARGET_DIR)/usr/lib/systemd/system/tempap-dnsmasq.service
	$(INSTALL) -D -m 0444 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/tempap-hostapd.service \
		$(TARGET_DIR)/usr/lib/systemd/system/tempap-hostapd.service
	$(INSTALL) -D -m 0444 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/tempap.service \
		$(TARGET_DIR)/usr/lib/systemd/system/tempap.service
	$(INSTALL) -D -m 0444 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/raspi-wifi/copy-config.service \
		$(TARGET_DIR)/usr/lib/systemd/system/copy-config.service
	mkdir -p $(TARGET_DIR)/etc/systemd/system/multi-user.target.wants
	ln -sf ../../../../usr/lib/systemd/system/copy-config.service \
		$(TARGET_DIR)/etc/systemd/system/multi-user.target.wants/copy-config.service
endef

$(eval $(generic-package))
