################################################################################
#
# hifiberry-ympd
#
################################################################################

define HIFIBERRY_YMPD_INSTALL_INIT_SYSTEMD
        $(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/hifiberry-ympd/ympd.service \
                $(TARGET_DIR)/usr/lib/systemd/system/ympd.service
endef

$(eval $(generic-package))
