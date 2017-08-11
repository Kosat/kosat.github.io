//Global go-to top button
jQuery(document).ready(function($) {
    var offset = 400,
        scroll_top_duration = 1500,
        $back_to_top = $('.global-btn-top');

    $(window).scroll(function() {
        if (jQuery(this).scrollTop() > 100) { 
            jQuery(".global-btn-top").fadeIn() 
        } 
        else { jQuery(".global-btn-top").fadeOut() 
        } 
    });

    $back_to_top.on('click', function(event) {
        event.preventDefault();
        $('body,html').animate({
            scrollTop: 0,
        }, scroll_top_duration);
    });
});